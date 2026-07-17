// Service worker (§4) : seul écrivain du storage, applique FSRS, badge.
// MV3 éphémère : aucun état mémoire supposé persistant.

import { LOG_PREFIX } from "../src/config";
import { gradeFor, nextState } from "../src/fsrs";
import {
  getCards,
  getLog,
  getPendingAccepted,
  getSettings,
  migrateIfNeeded,
  saveReview,
  setPendingAccepted,
} from "../src/storage";
import type {
  ProblemCard,
  ReviewInput,
  ReviewLogEntry,
  RuntimeRequest,
  RuntimeResponseMap,
} from "../src/types";

export default defineBackground(() => {
  console.log(`${LOG_PREFIX} background démarré`);

  void migrateIfNeeded().catch((err) => console.error(`${LOG_PREFIX} migration`, err));

  // Phase 0 : badge de test — remplacé en phase 3 par le vrai compteur de dus.
  void browser.action.setBadgeBackgroundColor({ color: "#ff5c5c" });
  void browser.action.setBadgeText({ text: "0" });

  // Les mutations sont sérialisées : pas de read-modify-write entrelacés.
  let writeQueue: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeQueue.then(fn);
    writeQueue = next.catch(() => undefined);
    return next;
  }

  browser.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      handle(message as RuntimeRequest)
        .then(sendResponse)
        .catch((err: unknown) => {
          console.error(`${LOG_PREFIX} message`, err);
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        });
      return true; // réponse asynchrone
    },
  );

  async function handle(msg: RuntimeRequest): Promise<unknown> {
    switch (msg.kind) {
      case "CHECK_COOLDOWN":
        return checkCooldown(msg.slug);
      case "PREVIEW_REVIEW":
        return previewReview(msg.slug, msg.mode, msg.feel);
      case "LOG_REVIEW":
        return serialized(() => logReview(msg.review));
      case "SET_PENDING_ACCEPTED":
        return serialized(async () => {
          await setPendingAccepted(msg.pending);
          return { ok: true } as const;
        });
      case "CLEAR_PENDING_ACCEPTED":
        return serialized(async () => {
          await setPendingAccepted(null);
          return { ok: true } as const;
        });
    }
  }

  /** §7 — dernier log du slug < reviewCooldownHours ⇒ ignorer l'Accepted. */
  async function checkCooldown(slug: string): Promise<RuntimeResponseMap["CHECK_COOLDOWN"]> {
    const [log, settings] = await Promise.all([getLog(), getSettings()]);
    const lastTs = log.filter((e) => e.slug === slug).at(-1)?.ts;
    if (lastTs === undefined) return { underCooldown: false }; // jamais suivi
    const elapsedH = (Date.now() - new Date(lastTs).getTime()) / 3_600_000;
    return { underCooldown: elapsedH < settings.reviewCooldownHours };
  }

  async function previewReview(
    slug: string,
    mode: ReviewInput["mode"],
    feel: ReviewInput["feel"],
  ): Promise<RuntimeResponseMap["PREVIEW_REVIEW"]> {
    const [cards, settings] = await Promise.all([getCards(), getSettings()]);
    const prev = cards[slug]?.fsrs ?? null;
    const grade = gradeFor(mode, feel, settings);
    return { scheduledDue: nextState(prev, grade, new Date(), settings).due };
  }

  async function logReview(review: ReviewInput): Promise<RuntimeResponseMap["LOG_REVIEW"]> {
    const now = new Date();
    const [cards, settings, pending] = await Promise.all([
      getCards(),
      getSettings(),
      getPendingAccepted(),
    ]);
    const existing = cards[review.slug];
    const grade = gradeFor(review.mode, review.feel, settings);
    const fsrs = nextState(existing?.fsrs ?? null, grade, now, settings);

    const card: ProblemCard = {
      slug: review.slug,
      frontendId: review.frontendId,
      title: review.title,
      lcDifficulty: review.lcDifficulty,
      ...(review.metaIncomplete ? { metaIncomplete: true } : {}),
      lastMode: review.mode,
      lastFeel: review.mode === "abandon" ? null : review.feel,
      fsrs,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const entry: ReviewLogEntry = {
      ts: now.toISOString(),
      slug: review.slug,
      mode: review.mode,
      feel: review.feel,
      grade,
      submissionsInSession: review.submissionsInSession,
      minutesInSession: review.minutesInSession,
      scheduledDue: fsrs.due,
    };
    await saveReview(card, entry);
    if (pending?.slug === review.slug) await setPendingAccepted(null);
    console.log(`${LOG_PREFIX} review loguée`, { slug: review.slug, grade, due: fsrs.due });
    // Phase 3 : recalcul du badge ici.
    return { scheduledDue: fsrs.due };
  }
});
