// Service worker : seul écrivain du storage, route les messages vers src/review
// et tient le badge à jour. MV3 éphémère : aucun état mémoire supposé persistant.

import {
  ALARM_BADGE_DAILY,
  ALARM_BADGE_PERIODIC,
  BADGE_COLOR,
  DAILY_ALARM_HOUR,
  DAILY_ALARM_MINUTE,
  LOG_PREFIX,
} from "../src/config";
import {
  checkCooldown,
  dueCards,
  logReview,
  previewReview,
  saveSettingsPatch,
  snoozeBanner,
} from "../src/review";
import {
  getCards,
  migrateIfNeeded,
  setPendingAccepted,
  updateCardMeta,
} from "../src/storage";
import type { RuntimeRequest } from "../src/types";

export default defineBackground(() => {
  console.log(`${LOG_PREFIX} background démarré`);

  void migrateIfNeeded()
    .then(updateBadge)
    .catch((err: unknown) => console.error(`${LOG_PREFIX} migration`, err));

  // Recalculs périodiques : jamais de setTimeout long en MV3.
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

  /** Prochain 00:05 local. */
  function nextDailyAlarmTime(): number {
    const next = new Date();
    next.setHours(DAILY_ALARM_HOUR, DAILY_ALARM_MINUTE, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  async function updateBadge(): Promise<void> {
    try {
      const count = dueCards(await getCards()).length;
      try {
        // Safari applique son propre style de badge et peut ignorer la couleur.
        await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      } catch {
        /* sans importance */
      }
      await browser.action.setBadgeText({ text: count > 0 ? String(count) : "" });
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
        return serialized(async () => {
          const result = await logReview(msg.review);
          await updateBadge();
          return result;
        });
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
          await updateCardMeta(msg.slug, { title: msg.title, ncDifficulty: msg.ncDifficulty });
          return { ok: true } as const;
        });
      case "SNOOZE_BANNER":
        return serialized(async () => {
          await snoozeBanner();
          return { ok: true } as const;
        });
      case "SAVE_SETTINGS":
        return serialized(async () => {
          await saveSettingsPatch(msg.settings);
          await updateBadge();
          return { ok: true } as const;
        });
    }
  }
});
