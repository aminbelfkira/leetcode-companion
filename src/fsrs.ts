// Wrapper ts-fsrs (§8) : mapping grade, scheduling, sérialisation FsrsState ↔ Card.

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card,
  type Grade,
} from "ts-fsrs";
import type { Feel, FsrsState, Mode, Settings } from "./types";

export type FsrsGrade = 1 | 2 | 3 | 4; // Rating Again/Hard/Good/Easy

function scheduler(settings: Settings) {
  return fsrs(
    generatorParameters({
      request_retention: settings.requestRetention,
      maximum_interval: settings.maximumIntervalDays,
      enable_fuzz: true,
      // §7/§9 exigent « Again → prochaine révision : demain » : les steps
      // courts (1 min/10 min) des flashcards n'ont pas de sens pour des
      // problèmes LeetCode, on planifie toujours à la journée.
      enable_short_term: false,
    }),
  );
}

/** Mapping §7 : (mode, ressenti) → grade FSRS. */
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

function toCard(s: FsrsState): Card {
  const lastReview = s.last_review === null ? undefined : new Date(s.last_review);
  const due = new Date(s.due);
  const scheduledDays =
    lastReview !== undefined
      ? Math.max(0, Math.round((due.getTime() - lastReview.getTime()) / 86_400_000))
      : 0;
  return {
    due,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: 0, // déprécié côté ts-fsrs, recalculé depuis last_review
    scheduled_days: scheduledDays,
    learning_steps: 0, // steps courts désactivés (enable_short_term: false)
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    ...(lastReview !== undefined ? { last_review: lastReview } : {}),
  };
}

function fromCard(c: Card): FsrsState {
  return {
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    last_review: c.last_review instanceof Date ? c.last_review.toISOString() : null,
  };
}

/**
 * Applique une review. `prev = null` pour une première carte
 * (createEmptyCard puis next, §8).
 */
export function nextState(
  prev: FsrsState | null,
  grade: FsrsGrade,
  now: Date,
  settings: Settings,
): FsrsState {
  const f = scheduler(settings);
  const card = prev === null ? createEmptyCard(now) : toCard(prev);
  // FsrsGrade et Grade (Rating sans Manual) ont les mêmes valeurs 1–4.
  const { card: next } = f.next(card, now, grade as Grade);
  return fromCard(next);
}

/** Nombre de jours (arrondi sup., min 0) entre `now` et une due ISO. */
export function daysUntil(dueIso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(dueIso).getTime() - now.getTime()) / 86_400_000));
}

/** « demain » / « dans {n} j » / « aujourd'hui » pour l'UI. */
export function formatDueRelative(dueIso: string, now: Date = new Date()): string {
  const days = daysUntil(dueIso, now);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "demain";
  return `dans ${days} j`;
}
