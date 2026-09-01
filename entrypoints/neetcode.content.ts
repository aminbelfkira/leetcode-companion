// Monde ISOLATED NeetCode : consomme les événements du script MAIN, gère les
// sessions et affiche la même expérience FSRS que sur LeetCode.

import { LOG_PREFIX, PAGE_MSG_SOURCE, SESSION_MAX_AGE_H } from "../src/config";
import {
  isAcceptedVerdict,
  listSlugFromSearch,
  problemSlugFromPathname,
  submissionIndexFromSearch,
} from "../src/nc-endpoints";
import { resolveMeta } from "../src/nc-meta";
import { sendToBackground } from "../src/messaging";
import { findExistingProblemId, problemUrl } from "../src/problem-identity";
import { dueCards } from "../src/review";
import { getCards, getSettings } from "../src/storage";
import { removeBanner, renderBanner } from "../src/ui/banner";
import { isPanelMounted, mountPanel } from "../src/ui/panel";
import type { NcPageMessage, ProblemDescriptor } from "../src/types";

interface ProblemSession {
  slug: string;
  startedAt: number;
  submitCount: number;
}

interface SubmissionContext {
  token: string;
  slug: string;
  listSlug: string | null;
  submissionsInSession: number;
  sessionStartedAt: number;
  initialSubmissionIndex: string | null;
  acceptedInitiallyVisible: boolean;
  expiresAt: number;
  timer: number | null;
}

interface AcceptedSnapshot {
  slug: string;
  listSlug: string | null;
  submissionsInSession: number;
  minutesInSession: number;
}

const MAX_SUBMISSION_CONTEXTS = 128;
const FALLBACK_TTL_MS = 30_000;

export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  runAt: "document_start",
  main() {
    const storageReady = sendToBackground({ kind: "STORAGE_READY" });
    let session: ProblemSession | null = null;
    const submissionContexts = new Map<string, SubmissionContext>();
    const handledAcceptedTokens = new Set<string>();
    const metaRepairTried = new Set<string>();

    function ensureSession(slug: string): ProblemSession {
      const now = Date.now();
      const stale =
        session !== null && now - session.startedAt > SESSION_MAX_AGE_H * 3_600_000;
      if (session === null || session.slug !== slug || stale) {
        session = { slug, startedAt: now, submitCount: 0 };
        console.log(`${LOG_PREFIX} nouvelle session NeetCode`, { slug, stale });
        void maybeRepairMeta(slug).catch((error: unknown) =>
          console.warn(`${LOG_PREFIX} repairMeta NeetCode`, error),
        );
      }
      return session;
    }

    function acceptedResultVisible(): boolean {
      return [...document.querySelectorAll<HTMLElement>(".submission-result-accepted")].some(
        (element) =>
          element.getClientRects().length > 0 &&
          isAcceptedVerdict(element.textContent),
      );
    }

    function pruneContexts(): void {
      while (submissionContexts.size > MAX_SUBMISSION_CONTEXTS) {
        const oldestToken = submissionContexts.keys().next().value;
        if (oldestToken === undefined) break;
        cancelFallback(oldestToken, true);
      }
      while (handledAcceptedTokens.size > MAX_SUBMISSION_CONTEXTS) {
        const oldestToken = handledAcceptedTokens.values().next().value;
        if (oldestToken === undefined) break;
        handledAcceptedTokens.delete(oldestToken);
      }
    }

    function cancelFallback(token: string, removeContext = false): void {
      const context = submissionContexts.get(token);
      if (context?.timer !== null && context?.timer !== undefined) {
        window.clearTimeout(context.timer);
        context.timer = null;
      }
      if (removeContext) submissionContexts.delete(token);
    }

    function snapshotFrom(context: SubmissionContext): AcceptedSnapshot {
      return {
        slug: context.slug,
        listSlug: context.listSlug,
        submissionsInSession: context.submissionsInSession,
        minutesInSession: Math.round((Date.now() - context.sessionStartedAt) / 60_000),
      };
    }

    function handleAcceptedOnce(
      token: string,
      snapshot: AcceptedSnapshot,
      source: "network" | "dom",
    ): void {
      if (handledAcceptedTokens.has(token)) return;
      handledAcceptedTokens.add(token);
      cancelFallback(token, true);
      pruneContexts();
      console.log(`${LOG_PREFIX} ✓ Accepted NeetCode détecté`, { ...snapshot, source });
      void handleAccepted(snapshot).catch((error: unknown) =>
        console.warn(`${LOG_PREFIX} handleAccepted NeetCode`, error),
      );
    }

    /**
     * NeetCode affiche parfois le verdict puis navigue vers history. Ce repli
     * ne s'arme qu'après un vrai Submit et ne traite jamais un ancien historique.
     */
    function armDomAcceptedFallback(context: SubmissionContext): void {
      function poll(): void {
        if (submissionContexts.get(context.token) !== context) return;
        const currentIndex = submissionIndexFromSearch(location.search);
        const submissionChanged =
          currentIndex !== null && currentIndex !== context.initialSubmissionIndex;
        const acceptedNow = acceptedResultVisible();
        if (
          problemSlugFromPathname(location.pathname) === context.slug &&
          acceptedNow &&
          (submissionChanged || !context.acceptedInitiallyVisible)
        ) {
          handleAcceptedOnce(context.token, snapshotFrom(context), "dom");
          return;
        }
        if (Date.now() >= context.expiresAt) {
          cancelFallback(context.token, true);
          return;
        }
        context.timer = window.setTimeout(poll, 300);
      }
      context.timer = window.setTimeout(poll, 300);
    }

    async function maybeRepairMeta(slug: string): Promise<void> {
      if (metaRepairTried.has(slug)) return;
      metaRepairTried.add(slug);
      await storageReady;
      const cards = await getCards();
      const partial: ProblemDescriptor = {
        platform: "neetcode",
        slug,
        title: slug,
        difficulty: "Unknown",
        frontendId: null,
        listSlug: listSlugFromSearch(location.search),
        metaIncomplete: true,
      };
      const problemId = findExistingProblemId(cards, partial);
      if (problemId === null || cards[problemId]?.metaIncomplete !== true) return;
      const meta = await resolveMeta(slug);
      if (meta.metaIncomplete) return;
      await sendToBackground({
        kind: "UPDATE_CARD_META",
        problem: {
          ...partial,
          title: meta.title,
          difficulty: meta.difficulty,
          metaIncomplete: false,
        },
      });
      console.log(`${LOG_PREFIX} métadonnées NeetCode réparées`, slug);
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === "object" && value !== null;
    }

    function isNullableString(value: unknown): value is string | null {
      return value === null || typeof value === "string";
    }

    function isNullableNumber(value: unknown): value is number | null {
      return value === null || typeof value === "number";
    }

    function isPageMessage(value: unknown): value is NcPageMessage {
      if (!isRecord(value) || value.source !== PAGE_MSG_SOURCE || !isRecord(value.payload)) {
        return false;
      }
      switch (value.type) {
        case "url-change":
          return (
            typeof value.payload.pathname === "string" &&
            typeof value.payload.search === "string"
          );
        case "submission-created":
          return (
            typeof value.payload.token === "string" &&
            isNullableString(value.payload.slug)
          );
        case "submission-result":
          return (
            typeof value.payload.token === "string" &&
            isNullableString(value.payload.slug) &&
            typeof value.payload.statusDescription === "string" &&
            isNullableNumber(value.payload.testCaseCount) &&
            isNullableNumber(value.payload.correctTestCaseCount)
          );
        default:
          return false;
      }
    }

    function onMessage(event: MessageEvent): void {
      try {
        if (event.source !== window || !isPageMessage(event.data)) return;
        const message = event.data;
        switch (message.type) {
          case "url-change": {
            const slug = problemSlugFromPathname(message.payload.pathname);
            if (slug !== null) ensureSession(slug);
            break;
          }
          case "submission-created": {
            const slug = message.payload.slug ?? problemSlugFromPathname(location.pathname);
            if (slug === null || submissionContexts.has(message.payload.token)) break;
            const current = ensureSession(slug);
            current.submitCount += 1;
            const context: SubmissionContext = {
              token: message.payload.token,
              slug,
              listSlug: listSlugFromSearch(location.search),
              submissionsInSession: current.submitCount,
              sessionStartedAt: current.startedAt,
              initialSubmissionIndex: submissionIndexFromSearch(location.search),
              acceptedInitiallyVisible: acceptedResultVisible(),
              expiresAt: Date.now() + FALLBACK_TTL_MS,
              timer: null,
            };
            submissionContexts.set(context.token, context);
            pruneContexts();
            armDomAcceptedFallback(context);
            console.log(`${LOG_PREFIX} soumission NeetCode créée`, {
              token: context.token,
              slug: context.slug,
              submitCount: context.submissionsInSession,
            });
            break;
          }
          case "submission-result": {
            const { token, statusDescription } = message.payload;
            const context = submissionContexts.get(token);
            if (context === undefined) break;
            cancelFallback(token);
            console.log(`${LOG_PREFIX} résultat NeetCode`, { token, statusDescription });
            if (isAcceptedVerdict(statusDescription)) {
              handleAcceptedOnce(token, snapshotFrom(context), "network");
            } else {
              submissionContexts.delete(token);
            }
            break;
          }
        }
      } catch (error) {
        console.warn(`${LOG_PREFIX} message NeetCode`, error);
      }
    }

    async function handleAccepted(snapshot: AcceptedSnapshot): Promise<void> {
      if (isPanelMounted()) return;

      const meta = await resolveMeta(snapshot.slug);
      const problem: ProblemDescriptor = {
        platform: "neetcode",
        slug: snapshot.slug,
        title: meta.title,
        difficulty: meta.difficulty,
        frontendId: null,
        listSlug: snapshot.listSlug,
        metaIncomplete: meta.metaIncomplete,
      };
      const { problemId, underCooldown } = await sendToBackground({
        kind: "PREPARE_ACCEPTED",
        problem,
      });
      if (underCooldown) {
        console.log(`${LOG_PREFIX} Accepted NeetCode ignoré (cooldown)`, snapshot.slug);
        return;
      }

      const acceptedAt = new Date().toISOString();
      mountPanel(
        {
          title: problem.title,
          difficulty: problem.difficulty,
          platform: "NeetCode",
          submissionsInSession: snapshot.submissionsInSession,
          minutesInSession: snapshot.minutesInSession,
        },
        {
          previewDue: async (mode, feel) => {
            const { scheduledDue } = await sendToBackground({
              kind: "PREVIEW_REVIEW",
              problemId,
              mode,
              feel,
            });
            return scheduledDue;
          },
          onSave: async (mode, feel) => {
            try {
              const { scheduledDue } = await sendToBackground({
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
              return scheduledDue;
            } catch (error) {
              console.warn(`${LOG_PREFIX} LOG_REVIEW NeetCode`, error);
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
            }).catch((error: unknown) =>
              console.warn(`${LOG_PREFIX} pendingAccepted NeetCode`, error),
            );
          },
        },
      );
    }

    async function refreshBanner(): Promise<void> {
      try {
        await storageReady;
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
              if (card !== undefined) location.assign(problemUrl(card, "neetcode"));
            },
            onSnooze: () => {
              void sendToBackground({ kind: "SNOOZE_BANNER" }).catch(
                (error: unknown) => console.warn(`${LOG_PREFIX} snooze`, error),
              );
            },
          },
        );
      } catch (error) {
        console.warn(`${LOG_PREFIX} bandeau NeetCode`, error);
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
    console.log(`${LOG_PREFIX} content NeetCode actif`);
  },
});
