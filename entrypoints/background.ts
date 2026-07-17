// Service worker (§4) : seul écrivain du storage, applique FSRS, badge.
// MV3 éphémère : aucun état mémoire supposé persistant.

import {
  ALARM_BADGE_DAILY,
  ALARM_BADGE_PERIODIC,
  BADGE_COLOR,
  DAILY_ALARM_HOUR,
  DAILY_ALARM_MINUTE,
  LOG_PREFIX,
} from "../src/config";
import { gradeFor, nextState } from "../src/fsrs";
import {
  getCards,
  getLog,
  getPendingAccepted,
  getSettings,
  migrateIfNeeded,
  saveReview,
  setPendingAccepted,
  setSettings,
  updateCardMeta,
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

  void migrateIfNeeded()
    .then(updateBadge)
    .catch((err) => console.error(`${LOG_PREFIX} migration`, err));

  // §8 — recalculs périodiques (jamais de setTimeout long en MV3).
  void browser.alarms.create(ALARM_BADGE_PERIODIC, { periodInMinutes: 60 });
  void browser.alarms.create(ALARM_BADGE_DAILY, {
    when: nextDailyAlarmTime(),
    periodInMinutes: 24 * 60,
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_BADGE_PERIODIC || alarm.name === ALARM_BADGE_DAILY) {
      void updateBadge();
    }
  });

  /** Prochain 00:05 local (§8). */
  function nextDailyAlarmTime(): number {
    const next = new Date();
    next.setHours(DAILY_ALARM_HOUR, DAILY_ALARM_MINUTE, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  /** Badge = nombre de cartes dues (due <= maintenant, retards inclus). */
  async function updateBadge(): Promise<void> {
    try {
      const cards = await getCards();
      const now = Date.now();
      const due = Object.values(cards).filter(
        (c) => new Date(c.fsrs.due).getTime() <= now,
      ).length;
      await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await browser.action.setBadgeText({ text: due > 0 ? String(due) : "" });
    } catch (err) {
      console.error(`${LOG_PREFIX} badge`, err);
    }
  }

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
      case "UPDATE_CARD_META":
        return serialized(async () => {
          await updateCardMeta(msg.slug, {
            frontendId: msg.frontendId,
            title: msg.title,
            lcDifficulty: msg.lcDifficulty,
          });
          return { ok: true } as const;
        });
      case "SNOOZE_BANNER":
        return serialized(async () => {
          // §9.3 — snooze jusqu'au prochain minuit local.
          const midnight = new Date();
          midnight.setHours(24, 0, 0, 0);
          const settings = await getSettings();
          await setSettings({ ...settings, bannerSnoozedUntil: midnight.toISOString() });
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
    await updateBadge();
    return { scheduledDue: fsrs.due };
  }
});
