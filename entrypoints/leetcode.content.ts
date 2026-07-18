// Monde ISOLATED (§4) : consomme les événements du monde MAIN, gère la
// session par problème, monte le panneau de notation sur Accepted.

import { LOG_PREFIX, PAGE_MSG_SOURCE, SESSION_MAX_AGE_H } from "../src/config";
import { fetchAcceptedSubmissionForSync, resolveMeta } from "../src/lc-graphql";
import {
  LC_ORIGIN,
  isAcceptedVerdict,
  problemSlugFromPathname,
} from "../src/lc-endpoints";
import { sendToBackground } from "../src/messaging";
import { getCards, getSettings } from "../src/storage";
import { removeBanner, renderBanner } from "../src/ui/banner";
import { isPanelMounted, mountPanel } from "../src/ui/panel";
import type { PageMessage } from "../src/types";

interface ProblemSession {
  slug: string;
  startedAt: number; // epoch ms
  submitCount: number;
}

export default defineContentScript({
  matches: ["*://leetcode.com/*"],
  runAt: "document_start",
  main() {
    let session: ProblemSession | null = null;

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

    /** §10 — carte metaIncomplete : ré-essai GraphQL à la visite du problème. */
    const metaRepairTried = new Set<string>();
    async function maybeRepairMeta(slug: string): Promise<void> {
      if (metaRepairTried.has(slug)) return;
      metaRepairTried.add(slug);
      const cards = await getCards();
      if (cards[slug]?.metaIncomplete !== true) return;
      const meta = await resolveMeta(slug);
      if (meta.metaIncomplete) return; // toujours en échec, on retentera plus tard
      await sendToBackground({
        kind: "UPDATE_CARD_META",
        slug,
        frontendId: meta.frontendId,
        title: meta.title,
        lcDifficulty: meta.lcDifficulty,
      });
      console.log(`${LOG_PREFIX} métadonnées réparées`, slug);
    }

    function onMessage(event: MessageEvent): void {
      try {
        onMessageUnsafe(event);
      } catch (err) {
        console.warn(`${LOG_PREFIX} onMessage`, err); // jamais de crash visible (§10)
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
          // Hors /problems/* : on conserve la session (retour possible au même slug).
          if (slug !== null) ensureSession(slug);
          break;
        }
        case "submission-created": {
          const s = ensureSession(msg.payload.slug);
          s.submitCount += 1;
          console.log(`${LOG_PREFIX} soumission créée`, {
            id: msg.payload.id,
            slug: s.slug,
            submitCount: s.submitCount,
          });
          break;
        }
        case "submission-result": {
          const { id, statusMsg, statusCode } = msg.payload;
          console.log(`${LOG_PREFIX} submission-result`, { id, statusMsg, statusCode });
          const accepted = isAcceptedVerdict(statusMsg, statusCode);
          if (accepted && session !== null) {
            const minutes = Math.round((Date.now() - session.startedAt) / 60_000);
            const snapshot = {
              slug: session.slug,
              submissionsInSession: session.submitCount,
              minutesInSession: minutes,
            };
            console.log(`${LOG_PREFIX} ✓ Accepted détecté`, snapshot);
            void syncAcceptedToGithub(id, snapshot.slug).catch((err: unknown) =>
              console.warn(`${LOG_PREFIX} GitHub sync`, err),
            );
            handleAccepted(snapshot).catch((err: unknown) =>
              console.warn(`${LOG_PREFIX} handleAccepted`, err),
            );
          }
          break;
        }
      }
    }

    async function syncAcceptedToGithub(submissionId: string, slug: string): Promise<void> {
      const status = await sendToBackground({ kind: "GITHUB_GET_STATUS" });
      if (!status.enabled) return;

      let submission = null;
      for (const delayMs of [0, 500, 1_500]) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
        }
        submission = await fetchAcceptedSubmissionForSync(submissionId, slug);
        if (submission !== null) break;
      }
      if (submission === null) {
        throw new Error("Le détail de la soumission Accepted est indisponible");
      }

      const result = await sendToBackground({
        kind: "GITHUB_SYNC_SUBMISSION",
        submission,
      });
      console.log(
        `${LOG_PREFIX} GitHub ${result.synced ? "synchronisé" : "mis en attente"}`,
        result.path === null ? { pendingCount: result.pendingCount } : { path: result.path },
      );
    }

    /** §9.1 — métadonnées, cooldown, panneau de notation. */
    async function handleAccepted(snapshot: {
      slug: string;
      submissionsInSession: number;
      minutesInSession: number | null;
    }): Promise<void> {
      if (isPanelMounted()) return;

      const { underCooldown } = await sendToBackground({
        kind: "CHECK_COOLDOWN",
        slug: snapshot.slug,
      });
      if (underCooldown) {
        console.log(`${LOG_PREFIX} Accepted ignoré (cooldown)`, snapshot.slug);
        return;
      }

      const meta = await resolveMeta(snapshot.slug);
      const acceptedAt = new Date().toISOString();

      mountPanel(
        {
          frontendId: meta.frontendId,
          title: meta.title,
          lcDifficulty: meta.lcDifficulty,
          submissionsInSession: snapshot.submissionsInSession,
          minutesInSession: snapshot.minutesInSession,
        },
        {
          previewDue: async (mode, feel) => {
            const { scheduledDue } = await sendToBackground({
              kind: "PREVIEW_REVIEW",
              slug: snapshot.slug,
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
                  slug: snapshot.slug,
                  frontendId: meta.frontendId,
                  title: meta.title,
                  lcDifficulty: meta.lcDifficulty,
                  metaIncomplete: meta.metaIncomplete,
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
                slug: snapshot.slug,
                frontendId: meta.frontendId,
                title: meta.title,
                lcDifficulty: meta.lcDifficulty,
                submissionsInSession: snapshot.submissionsInSession,
                minutesInSession: snapshot.minutesInSession,
                acceptedAt,
              },
            }).catch((err: unknown) => console.warn(`${LOG_PREFIX} pendingAccepted`, err));
          },
        },
      );
    }

    // --- Bandeau (§9.3) --------------------------------------------------

    /** Affiche/retire le bandeau selon dus + snooze ; rappelé sur storage.onChanged. */
    async function refreshBanner(): Promise<void> {
      try {
        const [cards, settings] = await Promise.all([getCards(), getSettings()]);
        const now = Date.now();
        const snoozed =
          settings.bannerSnoozedUntil !== null &&
          new Date(settings.bannerSnoozedUntil).getTime() > now;
        const due = Object.values(cards)
          .filter((c) => new Date(c.fsrs.due).getTime() <= now)
          .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due));
        const oldest = due[0];
        if (snoozed || oldest === undefined) {
          removeBanner();
          return;
        }
        renderBanner(
          {
            count: due.length,
            next: { slug: oldest.slug, frontendId: oldest.frontendId, title: oldest.title },
          },
          {
            onOpen: (slug) => location.assign(`${LC_ORIGIN}/problems/${slug}/`),
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

    // Mise à jour live inter-onglets : reviews, snooze, etc.
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
