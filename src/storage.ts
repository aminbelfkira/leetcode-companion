// Accès typé à chrome.storage.local. Les mutations sont réservées au
// background afin de conserver un seul écrivain pour les données FSRS.

import { browser } from "wxt/browser";
import { preferredProblemId, sourceFromDescriptor } from "./problem-identity";
import { SUPABASE_SYNC_META_KEY } from "./supabase/config";
import {
  DEFAULT_SUPABASE_SYNC_META,
  type SupabaseSyncMeta,
} from "./supabase/types";
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

export async function getSupabaseSyncMeta(): Promise<SupabaseSyncMeta> {
  const stored = await readUnknown(SUPABASE_SYNC_META_KEY);
  return isRecord(stored)
    ? { ...DEFAULT_SUPABASE_SYNC_META, ...stored }
    : { ...DEFAULT_SUPABASE_SYNC_META };
}

export async function setSupabaseSyncMeta(meta: SupabaseSyncMeta): Promise<void> {
  await browser.storage.local.set({ [SUPABASE_SYNC_META_KEY]: meta });
}

async function dirtySyncMeta(): Promise<SupabaseSyncMeta> {
  const meta = await getSupabaseSyncMeta();
  return {
    ...meta,
    dirty: true,
    dirtyAt: new Date().toISOString(),
  };
}

/** Remplacement issu du serveur, sans recreer une mutation locale a envoyer. */
export async function replaceFsrsData(data: StorageShape): Promise<void> {
  await browser.storage.local.set({
    schemaVersion: SCHEMA_VERSION,
    cards: data.cards,
    log: data.log,
    settings: data.settings,
    pendingAccepted: data.pendingAccepted,
  });
}

// --- Mutations (background uniquement) -------------------------------------

export async function saveReview(card: ProblemCard, entry: ReviewLogEntry): Promise<void> {
  const [cards, log, supabaseSyncMeta] = await Promise.all([
    getCards(),
    getLog(),
    dirtySyncMeta(),
  ]);
  cards[card.id] = card;
  log.push(entry);
  await browser.storage.local.set({ cards, log, supabaseSyncMeta });
}

export async function saveProblemCard(card: ProblemCard): Promise<void> {
  const [cards, supabaseSyncMeta] = await Promise.all([
    getCards(),
    dirtySyncMeta(),
  ]);
  cards[card.id] = card;
  await browser.storage.local.set({ cards, supabaseSyncMeta });
}

export async function setPendingAccepted(pending: PendingAccepted | null): Promise<void> {
  await browser.storage.local.set({
    pendingAccepted: pending,
    [SUPABASE_SYNC_META_KEY]: await dirtySyncMeta(),
  });
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({
    settings,
    [SUPABASE_SYNC_META_KEY]: await dirtySyncMeta(),
  });
}

// --- Migration v1 LeetCode / anciennes variantes NeetCode -----------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function difficulty(value: unknown): Difficulty {
  return value === "Easy" || value === "Medium" || value === "Hard"
    ? value
    : "Unknown";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function validFeel(value: unknown): 1 | 2 | 3 | 4 | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function validGrade(value: unknown): 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 1;
}

interface MigratedCard {
  oldSlug: string;
  descriptor: ProblemDescriptor;
  card: ProblemCard;
}

function migrateOldCard(key: string, value: unknown, now: string): MigratedCard | null {
  if (!isRecord(value) || !isRecord(value.fsrs)) return null;
  const oldSlug = stringOr(value.slug, key);
  const title = stringOr(value.title, oldSlug);
  const platform: Platform =
    "ncDifficulty" in value && !("lcDifficulty" in value) ? "neetcode" : "leetcode";
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
  const updatedAt = stringOr(value.updatedAt, now);
  return {
    oldSlug,
    descriptor,
    card: {
      id,
      title,
      difficulty: descriptor.difficulty,
      sources: {
        [platform]: sourceFromDescriptor(descriptor, updatedAt),
      },
      ...(descriptor.metaIncomplete ? { metaIncomplete: true } : {}),
      lastMode:
        value.lastMode === "aide" || value.lastMode === "abandon"
          ? value.lastMode
          : "seul",
      lastFeel: validFeel(value.lastFeel),
      fsrs: value.fsrs as unknown as ProblemCard["fsrs"],
      createdAt: stringOr(value.createdAt, now),
      updatedAt,
    },
  };
}

function mergeMigratedCards(left: ProblemCard, right: ProblemCard): ProblemCard {
  const newest = left.updatedAt >= right.updatedAt ? left : right;
  const oldest = newest === left ? right : left;
  const complete = left.metaIncomplete !== true || right.metaIncomplete !== true;
  const bestMetadata =
    newest.metaIncomplete !== true
      ? newest
      : oldest.metaIncomplete !== true
        ? oldest
        : newest;
  const { metaIncomplete: _ignored, ...base } = newest;
  return {
    ...base,
    title: bestMetadata.title,
    difficulty: bestMetadata.difficulty,
    sources: { ...oldest.sources, ...newest.sources },
    ...(!complete ? { metaIncomplete: true } : {}),
    createdAt:
      left.createdAt <= right.createdAt ? left.createdAt : right.createdAt,
  };
}

async function migrateLegacySchema(): Promise<void> {
  const now = new Date().toISOString();
  const rawCards = await readUnknown("cards");
  const rawSettings = await readUnknown("settings");
  const migrated = isRecord(rawCards)
    ? Object.entries(rawCards)
        .map(([key, value]) => migrateOldCard(key, value, now))
        .filter((value): value is MigratedCard => value !== null)
    : [];

  const cards: Record<string, ProblemCard> = {};
  const oldToNew = new Map<string, string>();
  for (const item of migrated) {
    const existing = cards[item.card.id];
    cards[item.card.id] =
      existing === undefined ? item.card : mergeMigratedCards(existing, item.card);
    oldToNew.set(item.oldSlug, item.card.id);
  }

  const rawLog = await readUnknown("log");
  const log: ReviewLogEntry[] = Array.isArray(rawLog)
    ? rawLog.flatMap((value): ReviewLogEntry[] => {
        if (!isRecord(value) || typeof value.slug !== "string") return [];
        const migratedCard = migrated.find((item) => item.oldSlug === value.slug);
        const problemId = oldToNew.get(value.slug);
        if (migratedCard === undefined || problemId === undefined) return [];
        return [
          {
            ts: stringOr(value.ts, now),
            problemId,
            platform: migratedCard.descriptor.platform,
            mode:
              value.mode === "aide" || value.mode === "abandon" ? value.mode : "seul",
            feel: validFeel(value.feel),
            grade: validGrade(value.grade),
            submissionsInSession:
              typeof value.submissionsInSession === "number"
                ? value.submissionsInSession
                : 0,
            minutesInSession:
              typeof value.minutesInSession === "number" ? value.minutesInSession : null,
            scheduledDue: stringOr(value.scheduledDue, now),
          },
        ];
      })
    : [];

  const rawPending = await readUnknown("pendingAccepted");
  let pendingAccepted: PendingAccepted | null = null;
  if (isRecord(rawPending) && typeof rawPending.slug === "string") {
    const oldCard = migrated.find((item) => item.oldSlug === rawPending.slug);
    const platform: Platform =
      "ncDifficulty" in rawPending && !("lcDifficulty" in rawPending)
        ? "neetcode"
        : "leetcode";
    const problem: ProblemDescriptor = oldCard?.descriptor ?? {
      platform,
      slug: rawPending.slug,
      title: stringOr(rawPending.title, rawPending.slug),
      difficulty: difficulty(rawPending.lcDifficulty ?? rawPending.ncDifficulty),
      frontendId:
        typeof rawPending.frontendId === "string" ? rawPending.frontendId : null,
      listSlug:
        typeof rawPending.listSlug === "string"
          ? rawPending.listSlug
          : typeof rawPending.collectionSlug === "string"
            ? rawPending.collectionSlug
            : null,
      metaIncomplete:
        rawPending.metaIncomplete === true ||
        difficulty(rawPending.lcDifficulty ?? rawPending.ncDifficulty) === "Unknown",
    };
    pendingAccepted = {
      problemId: oldToNew.get(rawPending.slug) ?? preferredProblemId(problem),
      problem,
      submissionsInSession:
        typeof rawPending.submissionsInSession === "number"
          ? rawPending.submissionsInSession
          : 0,
      minutesInSession:
        typeof rawPending.minutesInSession === "number"
          ? rawPending.minutesInSession
          : null,
      acceptedAt: stringOr(rawPending.acceptedAt, now),
    };
  }

  // set() ne remplace que ces clés : auth Supabase, auth/dépôt/Device Flow
  // et file GitHub restent donc intacts pendant la migration FSRS.
  const hasLegacyData =
    migrated.length > 0 ||
    log.length > 0 ||
    pendingAccepted !== null ||
    isRecord(rawSettings);
  const supabaseSyncMeta = hasLegacyData
    ? await dirtySyncMeta()
    : await getSupabaseSyncMeta();
  await browser.storage.local.set({
    schemaVersion: SCHEMA_VERSION,
    cards,
    log,
    settings: await getSettings(),
    pendingAccepted,
    [SUPABASE_SYNC_META_KEY]: supabaseSyncMeta,
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
