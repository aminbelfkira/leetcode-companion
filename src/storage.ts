// Accès typé à browser.storage.local. Les MUTATIONS ne doivent être appelées
// que depuis le background (single-writer) ; les lectures sont libres.

import { browser } from "wxt/browser";
import type { PendingAccepted, ProblemCard, ReviewLogEntry, Settings } from "./types";

export const SCHEMA_VERSION = 1;

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
  const res = await browser.storage.local.get(key);
  return res[key] as StorageShape[K] | undefined;
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

/** Snapshot complet, utilisé par l'export JSON. */
export async function getAllData(): Promise<StorageShape> {
  const [cards, log, settings, pendingAccepted] = await Promise.all([
    getCards(),
    getLog(),
    getSettings(),
    getPendingAccepted(),
  ]);
  return { schemaVersion: SCHEMA_VERSION, cards, log, settings, pendingAccepted };
}

// --- Mutations (background uniquement) -------------------------------------

/**
 * Écrit une carte ET son entrée de log en un seul set() : jamais l'un sans
 * l'autre, le log étant la source de vérité.
 */
export async function saveReview(card: ProblemCard, entry: ReviewLogEntry): Promise<void> {
  const [cards, log] = await Promise.all([getCards(), getLog()]);
  cards[card.slug] = card;
  log.push(entry);
  await browser.storage.local.set({ cards, log });
}

/** Répare les métadonnées d'une carte marquée metaIncomplete. */
export async function updateCardMeta(
  slug: string,
  meta: Pick<ProblemCard, "title" | "ncDifficulty">,
): Promise<void> {
  const cards = await getCards();
  const card = cards[slug];
  if (card === undefined) return;
  const { metaIncomplete: _dropped, ...rest } = card;
  cards[slug] = { ...rest, ...meta, updatedAt: new Date().toISOString() };
  await browser.storage.local.set({ cards });
}

export async function setPendingAccepted(pending: PendingAccepted | null): Promise<void> {
  await browser.storage.local.set({ pendingAccepted: pending });
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings });
}

/** Init et migration du schéma au démarrage du background. */
export async function migrateIfNeeded(): Promise<void> {
  const version = (await read("schemaVersion")) ?? 0;
  if (version === SCHEMA_VERSION) return;
  if (version === 0) {
    await browser.storage.local.set({
      schemaVersion: SCHEMA_VERSION,
      cards: (await read("cards")) ?? {},
      log: (await read("log")) ?? [],
      settings: await getSettings(),
      pendingAccepted: (await read("pendingAccepted")) ?? null,
    });
    return;
  }
  // Versions futures : migrations explicites ici.
  throw new Error(`schemaVersion inconnue: ${version}`);
}
