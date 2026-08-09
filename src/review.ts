// Cœur métier : fenêtre anti-doublon, calcul d'échéance, écriture d'une review.
//
// Ces fonctions sont appelées uniquement par le background (single-writer),
// mais vivent hors de son entrypoint pour rester directement testables.

import { gradeFor, nextState } from "./fsrs";
import {
  getCards,
  getLog,
  getPendingAccepted,
  getSettings,
  saveReview,
  setPendingAccepted,
  setSettings,
} from "./storage";
import type {
  Feel,
  Mode,
  ProblemCard,
  ReviewInput,
  ReviewLogEntry,
  Settings,
} from "./types";

/** Cartes dues (échéance passée), retards inclus, de la plus ancienne à la plus récente. */
export function dueCards(
  cards: Record<string, ProblemCard>,
  now: number = Date.now(),
): ProblemCard[] {
  return Object.values(cards)
    .filter((card) => new Date(card.fsrs.due).getTime() <= now)
    .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due));
}

/** Un dernier log plus récent que `reviewCooldownHours` fait ignorer l'Accepted. */
export async function checkCooldown(slug: string): Promise<{ underCooldown: boolean }> {
  const [log, settings] = await Promise.all([getLog(), getSettings()]);
  const lastTs = log.filter((entry) => entry.slug === slug).at(-1)?.ts;
  if (lastTs === undefined) return { underCooldown: false }; // jamais suivi
  const elapsedH = (Date.now() - new Date(lastTs).getTime()) / 3_600_000;
  return { underCooldown: elapsedH < settings.reviewCooldownHours };
}

/** Échéance qu'obtiendrait la carte pour cette notation, sans rien écrire. */
export async function previewReview(
  slug: string,
  mode: Mode,
  feel: Feel | null,
): Promise<{ scheduledDue: string }> {
  const [cards, settings] = await Promise.all([getCards(), getSettings()]);
  const grade = gradeFor(mode, feel, settings);
  return { scheduledDue: nextState(cards[slug]?.fsrs ?? null, grade, new Date(), settings).due };
}

/** Écrit la carte et son entrée de log, puis retire l'Accepted en attente. */
export async function logReview(review: ReviewInput): Promise<{ scheduledDue: string }> {
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
  return { scheduledDue: fsrs.due };
}

/** Masque le bandeau jusqu'au prochain minuit local. */
export async function snoozeBanner(): Promise<void> {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const settings = await getSettings();
  await setSettings({ ...settings, bannerSnoozedUntil: midnight.toISOString() });
}

export async function saveSettingsPatch(patch: Partial<Settings>): Promise<void> {
  const settings = await getSettings();
  await setSettings({ ...settings, ...patch });
}
