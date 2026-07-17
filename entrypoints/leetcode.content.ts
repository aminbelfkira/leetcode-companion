// Monde ISOLATED (§4) : consomme les événements du monde MAIN, gère la
// session par problème, monte le panneau de notation sur Accepted.

import { LOG_PREFIX, PAGE_MSG_SOURCE, SESSION_MAX_AGE_H } from "../src/config";
import { resolveMeta } from "../src/lc-graphql";
import {
  STATUS_CODE_ACCEPTED,
  STATUS_MSG_ACCEPTED,
  problemSlugFromPathname,
} from "../src/lc-endpoints";
import { sendToBackground } from "../src/messaging";
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
      }
      return session;
    }

    function onMessage(event: MessageEvent): void {
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
          const accepted =
            statusMsg === STATUS_MSG_ACCEPTED && statusCode === STATUS_CODE_ACCEPTED;
          if (accepted && session !== null) {
            const minutes = Math.round((Date.now() - session.startedAt) / 60_000);
            const snapshot = {
              slug: session.slug,
              submissionsInSession: session.submitCount,
              minutesInSession: minutes,
            };
            console.log(`${LOG_PREFIX} ✓ Accepted détecté`, snapshot);
            handleAccepted(snapshot).catch((err: unknown) =>
              console.warn(`${LOG_PREFIX} handleAccepted`, err),
            );
          }
          break;
        }
      }
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

    window.addEventListener("message", onMessage);

    const initialSlug = problemSlugFromPathname(location.pathname);
    if (initialSlug !== null) ensureSession(initialSlug);

    console.log(`${LOG_PREFIX} content ISOLATED actif`);
  },
});
