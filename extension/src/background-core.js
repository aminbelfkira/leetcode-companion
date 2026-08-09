// Logique du background : seul écrivain du storage, applique FSRS, tient le
// badge. MV3 éphémère : aucun état mémoire supposé persistant.
//
// Le service worker (background.js) se contente de charger ses dépendances puis
// d'appeler NCC.startBackground(). Le harnais de test l'appelle directement.

self.NCC = self.NCC || {};

self.NCC.startBackground = function startBackground() {
  const NCC = self.NCC;
  const {
    ALARM_BADGE_DAILY,
    ALARM_BADGE_PERIODIC,
    BADGE_COLOR,
    DAILY_ALARM_HOUR,
    DAILY_ALARM_MINUTE,
    LOG_PREFIX,
    browser,
  } = NCC;

  console.log(`${LOG_PREFIX} background démarré`);

  void NCC.migrateIfNeeded()
    .then(updateBadge)
    .catch((err) => console.error(`${LOG_PREFIX} migration`, err));

  // Recalculs périodiques (jamais de setTimeout long en MV3).
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
  function nextDailyAlarmTime() {
    const next = new Date();
    next.setHours(DAILY_ALARM_HOUR, DAILY_ALARM_MINUTE, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  /** Badge = nombre de cartes dues (due <= maintenant, retards inclus). */
  async function updateBadge() {
    try {
      const cards = await NCC.getCards();
      const now = Date.now();
      const due = Object.values(cards).filter(
        (card) => new Date(card.fsrs.due).getTime() <= now,
      ).length;
      try {
        // Safari applique son propre style de badge et peut ignorer la couleur.
        await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      } catch {
        /* sans importance */
      }
      await browser.action.setBadgeText({ text: due > 0 ? String(due) : "" });
    } catch (err) {
      console.error(`${LOG_PREFIX} badge`, err);
    }
  }

  // Les mutations sont sérialisées : pas de read-modify-write entrelacés.
  let writeQueue = Promise.resolve();
  function serialized(fn) {
    const next = writeQueue.then(fn);
    writeQueue = next.catch(() => undefined);
    return next;
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handle(message)
      .then(sendResponse)
      .catch((err) => {
        console.error(`${LOG_PREFIX} message`, err);
        sendResponse({ error: err instanceof Error ? err.message : String(err) });
      });
    return true; // réponse asynchrone
  });

  async function handle(msg) {
    switch (msg.kind) {
      case "CHECK_COOLDOWN":
        return checkCooldown(msg.slug);
      case "PREVIEW_REVIEW":
        return previewReview(msg.slug, msg.mode, msg.feel);
      case "LOG_REVIEW":
        return serialized(() => logReview(msg.review));
      case "SET_PENDING_ACCEPTED":
        return serialized(async () => {
          await NCC.setPendingAccepted(msg.pending);
          return { ok: true };
        });
      case "CLEAR_PENDING_ACCEPTED":
        return serialized(async () => {
          await NCC.setPendingAccepted(null);
          return { ok: true };
        });
      case "UPDATE_CARD_META":
        return serialized(async () => {
          await NCC.updateCardMeta(msg.slug, {
            title: msg.title,
            ncDifficulty: msg.ncDifficulty,
          });
          return { ok: true };
        });
      case "SNOOZE_BANNER":
        return serialized(async () => {
          // Snooze jusqu'au prochain minuit local.
          const midnight = new Date();
          midnight.setHours(24, 0, 0, 0);
          const settings = await NCC.getSettings();
          await NCC.setSettings({
            ...settings,
            bannerSnoozedUntil: midnight.toISOString(),
          });
          return { ok: true };
        });
      case "SAVE_SETTINGS":
        return serialized(async () => {
          const current = await NCC.getSettings();
          await NCC.setSettings({ ...current, ...msg.settings });
          await updateBadge();
          return { ok: true };
        });
      default:
        throw new Error(`message inconnu: ${String(msg && msg.kind)}`);
    }
  }

  /** Dernier log du slug < reviewCooldownHours ⇒ ignorer l'Accepted. */
  async function checkCooldown(slug) {
    const [log, settings] = await Promise.all([NCC.getLog(), NCC.getSettings()]);
    const last = log.filter((entry) => entry.slug === slug).at(-1);
    if (last === undefined) return { underCooldown: false }; // jamais suivi
    const elapsedH = (Date.now() - new Date(last.ts).getTime()) / 3_600_000;
    return { underCooldown: elapsedH < settings.reviewCooldownHours };
  }

  async function previewReview(slug, mode, feel) {
    const [cards, settings] = await Promise.all([NCC.getCards(), NCC.getSettings()]);
    const prev = cards[slug]?.fsrs ?? null;
    const grade = NCC.gradeFor(mode, feel, settings);
    return { scheduledDue: NCC.nextState(prev, grade, new Date(), settings).due };
  }

  async function logReview(review) {
    const now = new Date();
    const [cards, settings, pending] = await Promise.all([
      NCC.getCards(),
      NCC.getSettings(),
      NCC.getPendingAccepted(),
    ]);
    const existing = cards[review.slug];
    const grade = NCC.gradeFor(review.mode, review.feel, settings);
    const fsrs = NCC.nextState(existing?.fsrs ?? null, grade, now, settings);

    const card = {
      slug: review.slug,
      title: review.title,
      ncDifficulty: review.ncDifficulty,
      listSlug: review.listSlug ?? existing?.listSlug ?? null,
      ...(review.metaIncomplete ? { metaIncomplete: true } : {}),
      lastMode: review.mode,
      lastFeel: review.mode === "abandon" ? null : review.feel,
      fsrs,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const entry = {
      ts: now.toISOString(),
      slug: review.slug,
      mode: review.mode,
      feel: review.feel,
      grade,
      submissionsInSession: review.submissionsInSession,
      minutesInSession: review.minutesInSession,
      scheduledDue: fsrs.due,
    };
    await NCC.saveReview(card, entry);
    if (pending?.slug === review.slug) await NCC.setPendingAccepted(null);
    console.log(`${LOG_PREFIX} review loguée`, {
      slug: review.slug,
      grade,
      due: fsrs.due,
    });
    await updateBadge();
    return { scheduledDue: fsrs.due };
  }
};
