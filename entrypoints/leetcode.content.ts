// Monde ISOLATED LeetCode : session, Accepted, métadonnées et UI de révision.

import { LOG_PREFIX, PAGE_MSG_SOURCE, SESSION_MAX_AGE_H } from "../src/config";
import {
  collectionSlugFromSearch,
  isAcceptedVerdict,
  problemSlugFromPathname,
} from "../src/lc-endpoints";
import { resolveLeetCodeMeta } from "../src/lc-meta";
import { sendToBackground } from "../src/messaging";
import { findExistingProblemId, problemUrl } from "../src/problem-identity";
import { dueCards } from "../src/review";
import { getCards, getSettings } from "../src/storage";
import { removeBanner, renderBanner } from "../src/ui/banner";
import { isPanelMounted, mountPanel } from "../src/ui/panel";
import { resetEditorForCompanionReview } from "../src/ui/review-reset";
import type { LcPageMessage, ProblemDescriptor } from "../src/types";

interface ProblemSession {
  slug: string;
  startedAt: number;
  submitCount: number;
}

interface AcceptedSnapshot {
  slug: string;
  listSlug: string | null;
  submissionsInSession: number;
  minutesInSession: number;
}

export default defineContentScript({
  matches: ["https://leetcode.com/*"],
  runAt: "document_start",
  main() {
    resetEditorForCompanionReview();
    let session: ProblemSession | null = null;
    const submissionLists = new Map<string, string | null>();
    const repaired = new Set<string>();
    const MAX_SUBMISSION_CONTEXTS = 128;

    function ensureSession(slug: string): ProblemSession {
      const now = Date.now();
      const stale = session !== null && now - session.startedAt > SESSION_MAX_AGE_H * 3_600_000;
      if (session === null || session.slug !== slug || stale) {
        session = { slug, startedAt: now, submitCount: 0 };
        void maybeRepairMeta(slug).catch((error: unknown) =>
          console.warn(`${LOG_PREFIX} repairMeta LeetCode`, error),
        );
      }
      return session;
    }

    function rememberList(id: string): void {
      submissionLists.set(id, collectionSlugFromSearch(location.search));
      while (submissionLists.size > MAX_SUBMISSION_CONTEXTS) {
        const oldest = submissionLists.keys().next().value;
        if (oldest === undefined) break;
        submissionLists.delete(oldest);
      }
    }

    function takeList(id: string): string | null {
      const value = submissionLists.has(id)
        ? (submissionLists.get(id) ?? null)
        : collectionSlugFromSearch(location.search);
      submissionLists.delete(id);
      return value;
    }

    async function maybeRepairMeta(slug: string): Promise<void> {
      if (repaired.has(slug)) return;
      repaired.add(slug);
      const cards = await getCards();
      const partial: ProblemDescriptor = {
        platform: "leetcode",
        slug,
        title: slug,
        difficulty: "Unknown",
        frontendId: null,
        listSlug: collectionSlugFromSearch(location.search),
        metaIncomplete: true,
      };
      const id = findExistingProblemId(cards, partial);
      if (id === null || cards[id]?.metaIncomplete !== true) return;
      const meta = await resolveLeetCodeMeta(slug);
      if (meta.metaIncomplete) return;
      await sendToBackground({
        kind: "UPDATE_CARD_META",
        problem: {
          ...partial,
          title: meta.title,
          difficulty: meta.difficulty,
          frontendId: meta.frontendId,
          metaIncomplete: false,
        },
      });
    }

    function onMessage(event: MessageEvent): void {
      try {
        if (event.source !== window) return;
        const data: unknown = event.data;
        if (
          typeof data !== "object" ||
          data === null ||
          (data as { source?: unknown }).source !== PAGE_MSG_SOURCE
        ) {
          return;
        }
        const message = data as LcPageMessage;
        switch (message.type) {
          case "url-change": {
            const slug = problemSlugFromPathname(message.payload.pathname);
            if (slug !== null) ensureSession(slug);
            break;
          }
          case "submission-created": {
            const current = ensureSession(message.payload.slug);
            current.submitCount += 1;
            rememberList(message.payload.id);
            break;
          }
          case "submission-result": {
            const { id, statusMsg, statusCode } = message.payload;
            const listSlug = takeList(id);
            if (!isAcceptedVerdict(statusMsg, statusCode) || session === null) break;
            const snapshot: AcceptedSnapshot = {
              slug: session.slug,
              listSlug,
              submissionsInSession: session.submitCount,
              minutesInSession: Math.round((Date.now() - session.startedAt) / 60_000),
            };
            void handleAccepted(snapshot).catch((error: unknown) =>
              console.warn(`${LOG_PREFIX} handleAccepted LeetCode`, error),
            );
            break;
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} message LeetCode`, error);
      }
    }

    async function handleAccepted(snapshot: AcceptedSnapshot): Promise<void> {
      if (isPanelMounted()) return;
      const meta = await resolveLeetCodeMeta(snapshot.slug);
      const problem: ProblemDescriptor = {
        platform: "leetcode",
        slug: snapshot.slug,
        title: meta.title,
        difficulty: meta.difficulty,
        frontendId: meta.frontendId,
        listSlug: snapshot.listSlug,
        metaIncomplete: meta.metaIncomplete,
      };
      const { problemId, underCooldown } = await sendToBackground({
        kind: "PREPARE_ACCEPTED",
        problem,
      });
      if (underCooldown) return;
      const acceptedAt = new Date().toISOString();

      mountPanel(
        {
          title: problem.title,
          difficulty: problem.difficulty,
          platform: "LeetCode",
          submissionsInSession: snapshot.submissionsInSession,
          minutesInSession: snapshot.minutesInSession,
        },
        {
          previewDue: async (mode, feel) => {
            const result = await sendToBackground({
              kind: "PREVIEW_REVIEW",
              problemId,
              mode,
              feel,
            });
            return result.scheduledDue;
          },
          onSave: async (mode, feel) => {
            try {
              const result = await sendToBackground({
                kind: "LOG_REVIEW",
                review: {
                  problemId,
                  problem,
                  mode,
                  feel,
                  submissionsInSession: snapshot.submissionsInSession,
                  minutesInSession: snapshot.minutesInSession,
                },
              });
              return result.scheduledDue;
            } catch (error) {
              console.warn(`${LOG_PREFIX} LOG_REVIEW LeetCode`, error);
              return null;
            }
          },
          onDismiss: () => {
            void sendToBackground({
              kind: "SET_PENDING_ACCEPTED",
              pending: {
                problemId,
                problem,
                submissionsInSession: snapshot.submissionsInSession,
                minutesInSession: snapshot.minutesInSession,
                acceptedAt,
              },
            });
          },
        },
      );
    }

    async function refreshBanner(): Promise<void> {
      try {
        const [cards, settings] = await Promise.all([getCards(), getSettings()]);
        const now = Date.now();
        const snoozed =
          settings.bannerSnoozedUntil !== null &&
          new Date(settings.bannerSnoozedUntil).getTime() > now;
        const due = dueCards(cards, now);
        const oldest = due[0];
        if (snoozed || oldest === undefined) {
          removeBanner();
          return;
        }
        renderBanner(
          { count: due.length, next: { id: oldest.id, title: oldest.title } },
          {
            onOpen: (problemId) => {
              const card = cards[problemId];
              if (card !== undefined) location.assign(problemUrl(card, "leetcode"));
            },
            onSnooze: () => {
              void sendToBackground({ kind: "SNOOZE_BANNER" });
            },
          },
        );
      } catch (error) {
        console.warn(`${LOG_PREFIX} bandeau LeetCode`, error);
      }
    }

    browser.storage.onChanged.addListener(() => void refreshBanner());
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => void refreshBanner(), { once: true });
    } else {
      void refreshBanner();
    }
    window.addEventListener("message", onMessage);
    const initialSlug = problemSlugFromPathname(location.pathname);
    if (initialSlug !== null) ensureSession(initialSlug);
    console.log(`${LOG_PREFIX} content LeetCode actif`);
  },
});
