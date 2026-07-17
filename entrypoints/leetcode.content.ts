// Monde ISOLATED (§4) : consomme les événements du monde MAIN, gère la
// session par problème. Phase 1 : logs console uniquement (pas d'UI).

import { LOG_PREFIX, PAGE_MSG_SOURCE, SESSION_MAX_AGE_H } from "../src/config";
import {
  STATUS_CODE_ACCEPTED,
  STATUS_MSG_ACCEPTED,
  problemSlugFromPathname,
} from "../src/lc-endpoints";
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
            // Phase 2 : montage du panneau de notation ici.
            console.log(`${LOG_PREFIX} ✓ Accepted détecté`, {
              slug: session.slug,
              submissionsInSession: session.submitCount,
              minutesInSession: minutes,
            });
          }
          break;
        }
      }
    }

    window.addEventListener("message", onMessage);

    const initialSlug = problemSlugFromPathname(location.pathname);
    if (initialSlug !== null) ensureSession(initialSlug);

    console.log(`${LOG_PREFIX} content ISOLATED actif`);
  },
});
