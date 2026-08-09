// Wrapper ts-fsrs : mapping grade, scheduling, sérialisation FsrsState vers Card.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type Card,
  type Grade,
  type State,
} from "ts-fsrs";
import type { Feel, FsrsState, Mode, Settings } from "./types";

export type FsrsGrade = 1 | 2 | 3 | 4; // Rating Again/Hard/Good/Easy

const DAY_MS = 86_400_000;

function scheduler(settings: Settings) {
  return fsrs(
    generatorParameters({
      request_retention: settings.requestRetention,
      // Plafond approximatif : ts-fsrs l'applique à chaque grade puis rétablit
      // Again < Hard < Good < Easy, ce qui peut le dépasser de trois jours.
      maximum_interval: settings.maximumIntervalDays,
      enable_fuzz: true,
      // « Again » doit donner « demain » : les steps courts (1 min, 10 min) des
      // flashcards n'ont pas de sens pour un problème d'algo, on planifie
      // toujours à la journée.
      enable_short_term: false,
    }),
  );
}

/** Mapping (mode, ressenti) vers grade FSRS. */
export function gradeFor(mode: Mode, feel: Feel | null, settings: Settings): FsrsGrade {
  if (mode === "aide" || mode === "abandon") return 1; // Again
  switch (feel) {
    case 4:
      return settings.arracheCountsAsAgain ? 1 : 2;
    case 3:
      return 2; // Hard
    case 2:
      return 3; // Good
    case 1:
      return 4; // Easy
    case null:
      throw new Error("mode 'seul' sans ressenti"); // impossible via l'UI
  }
}

function toCard(state: FsrsState): Card {
  const lastReview = state.last_review === null ? undefined : new Date(state.last_review);
  const due = new Date(state.due);
  const scheduledDays =
    lastReview !== undefined
      ? Math.max(0, Math.round((due.getTime() - lastReview.getTime()) / DAY_MS))
      : 0;
  return {
    due,
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: 0, // déprécié côté ts-fsrs, recalculé depuis last_review
    scheduled_days: scheduledDays,
    learning_steps: 0, // steps courts désactivés (enable_short_term: false)
    reps: state.reps,
    lapses: state.lapses,
    state: state.state as State,
    ...(lastReview !== undefined ? { last_review: lastReview } : {}),
  };
}

function fromCard(card: Card): FsrsState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review instanceof Date ? card.last_review.toISOString() : null,
  };
}

/** Applique une review. `prev = null` pour une première carte. */
export function nextState(
  prev: FsrsState | null,
  grade: FsrsGrade,
  now: Date,
  settings: Settings,
): FsrsState {
  const scheduled = scheduler(settings);
  const card = prev === null ? createEmptyCard(now) : toCard(prev);
  // FsrsGrade et Grade (Rating sans Manual) partagent les valeurs 1 à 4.
  const { card: next } = scheduled.next(card, now, grade as Grade);
  return fromCard(next);
}

/** Nombre de jours (arrondi supérieur, minimum 0) entre `now` et une due ISO. */
export function daysUntil(dueIso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(dueIso).getTime() - now.getTime()) / DAY_MS));
}

/** « aujourd'hui », « demain » ou « dans {n} j » pour l'UI. */
export function formatDueRelative(dueIso: string, now: Date = new Date()): string {
  const days = daysUntil(dueIso, now);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "demain";
  return `dans ${days} j`;
}
