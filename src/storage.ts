// Accès typé à browser.storage.local. Les mutations sont réservées au background.

import { browser } from "wxt/browser";
import { preferredProblemId, sourceFromDescriptor } from "./problem-identity";
import type {
  Difficulty,
  PendingAccepted,
  Platform,
  ProblemCard,
  ProblemDescriptor,
  ReviewLogEntry,
  Settings,
} from "./types";

export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  reviewCooldownHours: 8,
  requestRetention: 0.9,
  maximumIntervalDays: 180,
  arracheCountsAsAgain: false,
  bannerSnoozedUntil: null,
};

export interface StorageShape {
  schemaVersion: number;
  cards: Record<string, ProblemCard>;
  log: ReviewLogEntry[];
  settings: Settings;
  pendingAccepted: PendingAccepted | null;
}

async function read<K extends keyof StorageShape>(key: K): Promise<StorageShape[K] | undefined> {
  const result = await browser.storage.local.get(key);
  return result[key] as StorageShape[K] | undefined;
}

async function readUnknown(key: string): Promise<unknown> {
  return (await browser.storage.local.get(key))[key];
}

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await read("settings")) };
}

export async function getCards(): Promise<Record<string, ProblemCard>> {
  return (await read("cards")) ?? {};
}

export async function getLog(): Promise<ReviewLogEntry[]> {
  return (await read("log")) ?? [];
}

export async function getPendingAccepted(): Promise<PendingAccepted | null> {
  return (await read("pendingAccepted")) ?? null;
}

export async function getAllData(): Promise<StorageShape> {
  const [cards, log, settings, pendingAccepted] = await Promise.all([
    getCards(),
    getLog(),
    getSettings(),
    getPendingAccepted(),
  ]);
  return { schemaVersion: SCHEMA_VERSION, cards, log, settings, pendingAccepted };
}

export async function saveReview(card: ProblemCard, entry: ReviewLogEntry): Promise<void> {
  const [cards, log] = await Promise.all([getCards(), getLog()]);
  cards[card.id] = card;
  log.push(entry);
  await browser.storage.local.set({ cards, log });
}

export async function saveProblemCard(card: ProblemCard): Promise<void> {
  const cards = await getCards();
  cards[card.id] = card;
  await browser.storage.local.set({ cards });
}

export async function setPendingAccepted(pending: PendingAccepted | null): Promise<void> {
  await browser.storage.local.set({ pendingAccepted: pending });
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function difficulty(value: unknown): Difficulty {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
}

interface MigratedCard {
  oldSlug: string;
  card: ProblemCard;
  descriptor: ProblemDescriptor;
}

function migrateOldCard(key: string, value: unknown): MigratedCard | null {
  if (!isRecord(value)) return null;
  const oldSlug = typeof value.slug === "string" ? value.slug : key;
  const title = typeof value.title === "string" ? value.title : oldSlug;
  const platform: Platform = "lcDifficulty" in value ? "leetcode" : "neetcode";
  const descriptor: ProblemDescriptor = {
    platform,
    slug: oldSlug,
    title,
    difficulty: difficulty(value.lcDifficulty ?? value.ncDifficulty),
    frontendId: typeof value.frontendId === "string" ? value.frontendId : null,
    listSlug:
      typeof value.listSlug === "string"
        ? value.listSlug
        : typeof value.collectionSlug === "string"
          ? value.collectionSlug
          : null,
    metaIncomplete: value.metaIncomplete === true,
  };
  const id = preferredProblemId(descriptor);
  return {
    oldSlug,
    descriptor,
    card: {
      id,
      title,
      difficulty: descriptor.difficulty,
      sources: { [platform]: sourceFromDescriptor(descriptor, String(value.updatedAt ?? new Date().toISOString())) },
      ...(descriptor.metaIncomplete ? { metaIncomplete: true } : {}),
      lastMode: value.lastMode === "aide" || value.lastMode === "abandon" ? value.lastMode : "seul",
      lastFeel:
        value.lastFeel === 1 || value.lastFeel === 2 || value.lastFeel === 3 || value.lastFeel === 4
          ? value.lastFeel
          : null,
      fsrs: value.fsrs as ProblemCard["fsrs"],
      createdAt: String(value.createdAt ?? new Date().toISOString()),
      updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    },
  };
}

async function migrateLegacySchema(): Promise<void> {
  const rawCards = await readUnknown("cards");
  const migrated = isRecord(rawCards)
    ? Object.entries(rawCards)
        .map(([key, value]) => migrateOldCard(key, value))
        .filter((value): value is MigratedCard => value !== null)
    : [];
  const cards: Record<string, ProblemCard> = {};
  const oldToNew = new Map<string, string>();
  for (const item of migrated) {
    const existing = cards[item.card.id];
    cards[item.card.id] =
      existing === undefined || existing.updatedAt < item.card.updatedAt ? item.card : existing;
    oldToNew.set(item.oldSlug, item.card.id);
  }

  const rawLog = await readUnknown("log");
  const log: ReviewLogEntry[] = Array.isArray(rawLog)
    ? rawLog.flatMap((value): ReviewLogEntry[] => {
        if (!isRecord(value) || typeof value.slug !== "string") return [];
        const card = migrated.find((item) => item.oldSlug === value.slug);
        const problemId = oldToNew.get(value.slug);
        if (card === undefined || problemId === undefined) return [];
        return [{
          ts: String(value.ts),
          problemId,
          platform: card.descriptor.platform,
          mode: value.mode === "aide" || value.mode === "abandon" ? value.mode : "seul",
          feel:
            value.feel === 1 || value.feel === 2 || value.feel === 3 || value.feel === 4
              ? value.feel
              : null,
          grade: value.grade as ReviewLogEntry["grade"],
          submissionsInSession: Number(value.submissionsInSession ?? 0),
          minutesInSession:
            typeof value.minutesInSession === "number" ? value.minutesInSession : null,
          scheduledDue: String(value.scheduledDue),
        }];
      })
    : [];

  const rawPending = await readUnknown("pendingAccepted");
  let pendingAccepted: PendingAccepted | null = null;
  if (isRecord(rawPending) && typeof rawPending.slug === "string") {
    const oldCard = migrated.find((item) => item.oldSlug === rawPending.slug);
    const platform: Platform = "lcDifficulty" in rawPending ? "leetcode" : "neetcode";
    const problem: ProblemDescriptor = oldCard?.descriptor ?? {
      platform,
      slug: rawPending.slug,
      title: typeof rawPending.title === "string" ? rawPending.title : rawPending.slug,
      difficulty: difficulty(rawPending.lcDifficulty ?? rawPending.ncDifficulty),
      frontendId: typeof rawPending.frontendId === "string" ? rawPending.frontendId : null,
      listSlug: typeof rawPending.listSlug === "string" ? rawPending.listSlug : null,
      metaIncomplete: false,
    };
    pendingAccepted = {
      problemId: oldToNew.get(rawPending.slug) ?? preferredProblemId(problem),
      problem,
      submissionsInSession: Number(rawPending.submissionsInSession ?? 0),
      minutesInSession:
        typeof rawPending.minutesInSession === "number" ? rawPending.minutesInSession : null,
      acceptedAt: String(rawPending.acceptedAt ?? new Date().toISOString()),
    };
  }

  await browser.storage.local.set({
    schemaVersion: SCHEMA_VERSION,
    cards,
    log,
    settings: await getSettings(),
    pendingAccepted,
  });
}

export async function migrateIfNeeded(): Promise<void> {
  const version = (await read("schemaVersion")) ?? 0;
  if (version === SCHEMA_VERSION) return;
  if (version === 0 || version === 1) {
    await migrateLegacySchema();
    return;
  }
  throw new Error(`schemaVersion inconnue: ${version}`);
}
