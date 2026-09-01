// Cœur métier commun : identité multi-plateforme, anti-doublon et FSRS.

import { gradeFor, nextState } from "./fsrs";
import {
  findExistingProblemId,
  preferredProblemId,
  sourceFromDescriptor,
} from "./problem-identity";
import {
  getCards,
  getLog,
  getPendingAccepted,
  getSettings,
  saveProblemCard,
  saveReview,
  setPendingAccepted,
  setSettings,
} from "./storage";
import type {
  Feel,
  Mode,
  Platform,
  ProblemCard,
  ProblemDescriptor,
  ReviewInput,
  ReviewLogEntry,
  Settings,
} from "./types";

export function dueCards(
  cards: Record<string, ProblemCard>,
  now: number = Date.now(),
): ProblemCard[] {
  return Object.values(cards)
    .filter((card) => new Date(card.fsrs.due).getTime() <= now)
    .sort((left, right) => left.fsrs.due.localeCompare(right.fsrs.due));
}

function mergedTitle(existing: ProblemCard | undefined, problem: ProblemDescriptor): string {
  if (problem.metaIncomplete && existing !== undefined) return existing.title;
  if (problem.platform === "neetcode" && existing?.sources.leetcode !== undefined) {
    return existing.title;
  }
  return problem.title;
}

function mergedDifficulty(
  existing: ProblemCard | undefined,
  problem: ProblemDescriptor,
): ProblemCard["difficulty"] {
  return problem.difficulty === "Unknown" && existing !== undefined
    ? existing.difficulty
    : problem.difficulty;
}

export async function checkCooldown(
  problemId: string,
  platform?: Platform,
): Promise<{ underCooldown: boolean }> {
  const [log, settings] = await Promise.all([getLog(), getSettings()]);
  const lastTs = log
    .filter(
      (entry) =>
        entry.problemId === problemId &&
        (platform === undefined || entry.platform === platform),
    )
    .at(-1)?.ts;
  if (lastTs === undefined) return { underCooldown: false };
  const elapsedHours = (Date.now() - new Date(lastTs).getTime()) / 3_600_000;
  return { underCooldown: elapsedHours < settings.reviewCooldownHours };
}

/**
 * Résout l'identité avant l'affichage du panneau. Si la carte existe déjà,
 * sa nouvelle source est mémorisée même lorsqu'un cooldown ignore l'Accepted.
 */
export async function prepareAccepted(
  problem: ProblemDescriptor,
): Promise<{ problemId: string; underCooldown: boolean }> {
  const cards = await getCards();
  const problemId = findExistingProblemId(cards, problem) ?? preferredProblemId(problem);
  const existing = cards[problemId];
  if (existing !== undefined) {
    const now = new Date().toISOString();
    const source = sourceFromDescriptor(
      problem,
      now,
      existing.sources[problem.platform],
    );
    const { metaIncomplete: _oldIncomplete, ...completeExisting } = existing;
    await saveProblemCard({
      ...completeExisting,
      title: mergedTitle(existing, problem),
      difficulty: mergedDifficulty(existing, problem),
      sources: { ...existing.sources, [problem.platform]: source },
      ...(existing.metaIncomplete === true && problem.metaIncomplete
        ? { metaIncomplete: true }
        : {}),
      updatedAt: now,
    });
  }
  return { problemId, ...(await checkCooldown(problemId, problem.platform)) };
}

export async function previewReview(
  problemId: string,
  mode: Mode,
  feel: Feel | null,
): Promise<{ scheduledDue: string }> {
  const [cards, settings] = await Promise.all([getCards(), getSettings()]);
  const grade = gradeFor(mode, feel, settings);
  return {
    scheduledDue: nextState(
      cards[problemId]?.fsrs ?? null,
      grade,
      new Date(),
      settings,
    ).due,
  };
}

export async function logReview(review: ReviewInput): Promise<{ scheduledDue: string }> {
  const now = new Date();
  const [cards, settings, pending] = await Promise.all([
    getCards(),
    getSettings(),
    getPendingAccepted(),
  ]);
  const existing = cards[review.problemId];
  const grade = gradeFor(review.mode, review.feel, settings);
  const fsrs = nextState(existing?.fsrs ?? null, grade, now, settings);
  const problem = review.problem;
  const card: ProblemCard = {
    id: review.problemId,
    title: mergedTitle(existing, problem),
    difficulty: mergedDifficulty(existing, problem),
    sources: {
      ...existing?.sources,
      [problem.platform]: sourceFromDescriptor(
        problem,
        now.toISOString(),
        existing?.sources[problem.platform],
      ),
    },
    ...(problem.metaIncomplete &&
    (existing === undefined || existing.metaIncomplete === true)
      ? { metaIncomplete: true }
      : {}),
    lastMode: review.mode,
    lastFeel: review.mode === "abandon" ? null : review.feel,
    fsrs,
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const entry: ReviewLogEntry = {
    ts: now.toISOString(),
    problemId: review.problemId,
    platform: problem.platform,
    mode: review.mode,
    feel: review.mode === "abandon" ? null : review.feel,
    grade,
    submissionsInSession: review.submissionsInSession,
    minutesInSession: review.minutesInSession,
    scheduledDue: fsrs.due,
  };
  await saveReview(card, entry);
  if (pending?.problemId === review.problemId) await setPendingAccepted(null);
  return { scheduledDue: fsrs.due };
}

export async function updateCardMeta(problem: ProblemDescriptor): Promise<void> {
  const cards = await getCards();
  const problemId = findExistingProblemId(cards, problem);
  if (problemId === null) return;
  const card = cards[problemId];
  if (card === undefined) return;
  const now = new Date().toISOString();
  const { metaIncomplete: _dropped, ...rest } = card;
  await saveProblemCard({
    ...rest,
    title: mergedTitle(card, problem),
    difficulty: mergedDifficulty(card, problem),
    sources: {
      ...card.sources,
      [problem.platform]: sourceFromDescriptor(
        problem,
        now,
        card.sources[problem.platform],
      ),
    },
    ...(problem.metaIncomplete ? { metaIncomplete: true } : {}),
    updatedAt: now,
  });
}

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
