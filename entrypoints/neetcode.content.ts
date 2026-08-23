// Monde ISOLATED : injecte l'intercepteur, consomme ses événements, gère la
// session par problème, monte le panneau de notation sur Accepted.

import { injectScript } from "wxt/utils/inject-script";
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
import type { PageMessage, ProblemDescriptor } from "../src/types";

interface ProblemSession {
  slug: string;
  startedAt: number; // epoch ms
  submitCount: number;
}

interface AcceptedSnapshot {
  slug: string;
  listSlug: string | null;
  submissionsInSession: number;
  minutesInSession: number;
}

export default defineContentScript({
  matches: ["https://neetcode.io/*"],
  runAt: "document_start",
  main() {
    void injectScript("/interceptor.js").catch((err: unknown) =>
      console.warn(`${LOG_PREFIX} injection interceptor`, err),
    );

    let session: ProblemSession | null = null;

    /** Contexte de liste mémorisé au départ de chaque soumission. */
    const submissionLists = new Map<string, string | null>();
    const MAX_SUBMISSION_CONTEXTS = 128;

    interface DomAcceptedFallback {
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

    let domAcceptedFallback: DomAcceptedFallback | null = null;
    const handledAcceptedTokens = new Set<string>();

    function rememberSubmissionList(token: string): void {
      submissionLists.set(token, listSlugFromSearch(location.search));
      while (submissionLists.size > MAX_SUBMISSION_CONTEXTS) {
        const oldest = submissionLists.keys().next().value;
        if (oldest === undefined) break;
        submissionLists.delete(oldest);
      }
    }

    function takeSubmissionList(token: string): string | null {
      const value = submissionLists.has(token)
        ? (submissionLists.get(token) ?? null)
        : listSlugFromSearch(location.search);
      submissionLists.delete(token);
      return value;
    }

    function acceptedResultVisible(): boolean {
      return [...document.querySelectorAll<HTMLElement>(".submission-result-accepted")].some(
        (element) =>
          element.getClientRects().length > 0 && isAcceptedVerdict(element.textContent),
      );
    }

    function cancelDomAcceptedFallback(token?: string): void {
      if (domAcceptedFallback === null) return;
      if (token !== undefined && domAcceptedFallback.token !== token) return;
      if (domAcceptedFallback.timer !== null) window.clearTimeout(domAcceptedFallback.timer);
      domAcceptedFallback = null;
    }

    function handleAcceptedOnce(
      token: string,
      snapshot: AcceptedSnapshot,
      source: "network" | "dom",
    ): void {
      if (handledAcceptedTokens.has(token)) return;
      handledAcceptedTokens.add(token);
      while (handledAcceptedTokens.size > MAX_SUBMISSION_CONTEXTS) {
        const oldest = handledAcceptedTokens.values().next().value;
        if (oldest === undefined) break;
        handledAcceptedTokens.delete(oldest);
      }
      console.log(`${LOG_PREFIX} ✓ Accepted détecté`, { ...snapshot, source });
      handleAccepted(snapshot).catch((err: unknown) =>
        console.warn(`${LOG_PREFIX} handleAccepted`, err),
      );
    }

    /**
     * NeetCode affiche le verdict puis navigue vers /history?submissionIndex=….
     * Ce repli ne s'arme qu'après un vrai départ de soumission et ne lit jamais
     * une ancienne page d'historique comme un nouvel Accepted.
     */
    function armDomAcceptedFallback(
      token: string,
      current: ProblemSession,
      listSlug: string | null,
    ): void {
      cancelDomAcceptedFallback();
      const fallback: DomAcceptedFallback = {
        token,
        slug: current.slug,
        listSlug,
        submissionsInSession: current.submitCount,
        sessionStartedAt: current.startedAt,
        initialSubmissionIndex: submissionIndexFromSearch(location.search),
        acceptedInitiallyVisible: acceptedResultVisible(),
        expiresAt: Date.now() + 30_000,
        timer: null,
      };
      domAcceptedFallback = fallback;

      function poll(): void {
        if (domAcceptedFallback !== fallback) return;
        const currentIndex = submissionIndexFromSearch(location.search);
        const submissionChanged =
          currentIndex !== null && currentIndex !== fallback.initialSubmissionIndex;
        const acceptedNow = acceptedResultVisible();
        if (
          problemSlugFromPathname(location.pathname) === fallback.slug &&
          acceptedNow &&
          (submissionChanged || !fallback.acceptedInitiallyVisible)
        ) {
          domAcceptedFallback = null;
          submissionLists.delete(fallback.token);
          handleAcceptedOnce(
            fallback.token,
            {
              slug: fallback.slug,
              listSlug: fallback.listSlug,
              submissionsInSession: fallback.submissionsInSession,
              minutesInSession: Math.round((Date.now() - fallback.sessionStartedAt) / 60_000),
            },
            "dom",
          );
          return;
        }
        if (Date.now() >= fallback.expiresAt) {
          domAcceptedFallback = null;
          return;
        }
        fallback.timer = window.setTimeout(poll, 300);
      }

      fallback.timer = window.setTimeout(poll, 300);
    }

    function ensureSession(slug: string): ProblemSession {
      const now = Date.now();
      const stale =
        session !== null && now - session.startedAt > SESSION_MAX_AGE_H * 3_600_000;
      if (session === null || session.slug !== slug || stale) {
        session = { slug, startedAt: now, submitCount: 0 };
        console.log(`${LOG_PREFIX} nouvelle session`, { slug, stale });
        void maybeRepairMeta(slug).catch((err: unknown) =>
          console.warn(`${LOG_PREFIX} repairMeta`, err),
        );
      }
      return session;
    }

    /** Carte metaIncomplete : nouvelle tentative à la visite du problème. */
    const metaRepairTried = new Set<string>();
    async function maybeRepairMeta(slug: string): Promise<void> {
      if (metaRepairTried.has(slug)) return;
      metaRepairTried.add(slug);
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
      if (meta.metaIncomplete) return; // toujours en échec, on retentera plus tard
      await sendToBackground({
        kind: "UPDATE_CARD_META",
        problem: {
          ...partial,
          title: meta.title,
          difficulty: meta.difficulty,
          metaIncomplete: false,
        },
      });
      console.log(`${LOG_PREFIX} métadonnées réparées`, slug);
    }

    function onMessage(event: MessageEvent): void {
      try {
        onMessageUnsafe(event);
      } catch (err) {
        console.warn(`${LOG_PREFIX} onMessage`, err); // jamais de crash visible
      }
    }

    function onMessageUnsafe(event: MessageEvent): void {
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (
        typeof data !== "object" ||
        data === null ||
        (data as { source?: unknown }).source !== PAGE_MSG_SOURCE
      ) {
        return;
      }
      const msg = data as PageMessage;

      switch (msg.type) {
        case "url-change": {
          const slug = problemSlugFromPathname(msg.payload.pathname);
          // Hors /problems/*, on conserve la session : retour possible au même slug.
          if (slug !== null) ensureSession(slug);
          break;
        }
        case "submission-created": {
          const slug = msg.payload.slug ?? problemSlugFromPathname(location.pathname);
          if (slug === null) break;
          const current = ensureSession(slug);
          current.submitCount += 1;
          rememberSubmissionList(msg.payload.token);
          armDomAcceptedFallback(
            msg.payload.token,
            current,
            submissionLists.get(msg.payload.token) ?? null,
          );
          console.log(`${LOG_PREFIX} soumission créée`, {
            token: msg.payload.token,
            slug: current.slug,
            submitCount: current.submitCount,
          });
          break;
        }
        case "submission-result": {
          const { token, statusDescription } = msg.payload;
          console.log(`${LOG_PREFIX} submission-result`, { token, statusDescription });
          cancelDomAcceptedFallback(token);
          const listSlug = takeSubmissionList(token);
          if (!isAcceptedVerdict(statusDescription) || session === null) break;
          const snapshot: AcceptedSnapshot = {
            slug: msg.payload.slug ?? session.slug,
            listSlug,
            submissionsInSession: session.submitCount,
            minutesInSession: Math.round((Date.now() - session.startedAt) / 60_000),
          };
          handleAcceptedOnce(token, snapshot, "network");
          break;
        }
      }
    }

    /** Métadonnées, fenêtre anti-doublon, panneau de notation. */
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
        console.log(`${LOG_PREFIX} Accepted ignoré (cooldown)`, snapshot.slug);
        return;
      }

      const acceptedAt = new Date().toISOString();

      mountPanel(
        {
          title: meta.title,
          difficulty: meta.difficulty,
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
            } catch (err) {
              console.warn(`${LOG_PREFIX} LOG_REVIEW`, err);
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
            }).catch((err: unknown) => console.warn(`${LOG_PREFIX} pendingAccepted`, err));
          },
        },
      );
    }

    // --- Bandeau ----------------------------------------------------------

    /** Affiche ou retire le bandeau selon les dus et le report. */
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
              if (card !== undefined) location.assign(problemUrl(card, "neetcode"));
            },
            onSnooze: () => {
              void sendToBackground({ kind: "SNOOZE_BANNER" }).catch((err: unknown) =>
                console.warn(`${LOG_PREFIX} snooze`, err),
              );
            },
          },
        );
      } catch (err) {
        console.warn(`${LOG_PREFIX} bandeau`, err);
      }
    }

    // Mise à jour live inter-onglets : reviews, report, etc.
    browser.storage.onChanged.addListener(() => {
      void refreshBanner();
    });

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => void refreshBanner(), { once: true });
    } else {
      void refreshBanner();
    }

    window.addEventListener("message", onMessage);

    const initialSlug = problemSlugFromPathname(location.pathname);
    if (initialSlug !== null) ensureSession(initialSlug);

    console.log(`${LOG_PREFIX} content ISOLATED actif`);
  },
});
