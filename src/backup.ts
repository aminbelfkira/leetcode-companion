import {
  findExistingProblemId,
  preferredProblemId,
  sourceFromDescriptor,
} from "./problem-identity";
import type {
  BackupSnapshot,
  Difficulty,
  Feel,
  ImportSummary,
  Mode,
  PendingAccepted,
  Platform,
  ProblemCard,
  ProblemDescriptor,
  ProblemSource,
  ReviewLogEntry,
  Settings,
} from "./types";

interface ParsedBackup {
  cards: Array<{ aliases: string[]; card: ProblemCard }>;
  log: Array<ReviewLogEntry & { problemId: string }>;
  settings: Record<string, unknown> | null;
  pendingAccepted: PendingAccepted | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function difficulty(value: unknown): Difficulty {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
}

function mode(value: unknown): Mode {
  return value === "aide" || value === "abandon" ? value : "seul";
}

function feel(value: unknown): Feel | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function validPlatform(value: unknown): value is Platform {
  return value === "leetcode" || value === "neetcode";
}

function validGrade(value: unknown): value is ReviewLogEntry["grade"] {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function parseSource(value: unknown, updatedAt: string): ProblemSource | null {
  if (!isRecord(value) || typeof value.slug !== "string" || value.slug.length === 0) return null;
  return {
    slug: value.slug,
    frontendId: nullableText(value.frontendId),
    listSlug: nullableText(value.listSlug),
    difficulty: difficulty(value.difficulty),
    lastSeenAt: text(value.lastSeenAt, updatedAt),
  };
}

function parseFsrs(value: unknown): ProblemCard["fsrs"] | null {
  if (!isRecord(value) || typeof value.due !== "string") return null;
  return {
    due: value.due,
    stability: finite(value.stability),
    difficulty: finite(value.difficulty),
    reps: finite(value.reps),
    lapses: finite(value.lapses),
    state: finite(value.state),
    last_review: nullableText(value.last_review),
  };
}

function parseV2Card(key: string, value: unknown): ProblemCard | null {
  if (!isRecord(value)) return null;
  const fsrs = parseFsrs(value.fsrs);
  const id = text(value.id, key);
  const title = text(value.title);
  if (fsrs === null || id.length === 0 || title.length === 0 || !isRecord(value.sources)) return null;
  const updatedAt = text(value.updatedAt, new Date().toISOString());
  const sources: ProblemCard["sources"] = {};
  for (const platform of ["leetcode", "neetcode"] as const) {
    const source = parseSource(value.sources[platform], updatedAt);
    if (source !== null) sources[platform] = source;
  }
  if (Object.keys(sources).length === 0) return null;
  return {
    id,
    title,
    difficulty: difficulty(value.difficulty),
    sources,
    ...(value.metaIncomplete === true ? { metaIncomplete: true } : {}),
    lastMode: mode(value.lastMode),
    lastFeel: feel(value.lastFeel),
    fsrs,
    createdAt: text(value.createdAt, updatedAt),
    updatedAt,
  };
}

function legacyCard(key: string, value: unknown): { aliases: string[]; card: ProblemCard } | null {
  if (!isRecord(value)) return null;
  const oldSlug = text(value.slug, key);
  const title = text(value.title, oldSlug);
  const platform: Platform = "lcDifficulty" in value ? "leetcode" : "neetcode";
  const descriptor: ProblemDescriptor = {
    platform,
    slug: oldSlug,
    title,
    difficulty: difficulty(value.lcDifficulty ?? value.ncDifficulty ?? value.difficulty),
    frontendId: nullableText(value.frontendId),
    listSlug: nullableText(value.listSlug ?? value.collectionSlug),
    metaIncomplete: value.metaIncomplete === true,
  };
  const fsrs = parseFsrs(value.fsrs);
  if (fsrs === null || oldSlug.length === 0) return null;
  const updatedAt = text(value.updatedAt, new Date().toISOString());
  const id = preferredProblemId(descriptor);
  return {
    aliases: [key, oldSlug, id],
    card: {
      id,
      title,
      difficulty: descriptor.difficulty,
      sources: { [platform]: sourceFromDescriptor(descriptor, updatedAt) },
      ...(descriptor.metaIncomplete ? { metaIncomplete: true } : {}),
      lastMode: mode(value.lastMode),
      lastFeel: feel(value.lastFeel),
      fsrs,
      createdAt: text(value.createdAt, updatedAt),
      updatedAt,
    },
  };
}

function descriptorFromSource(
  card: ProblemCard,
  platform: Platform,
): ProblemDescriptor | null {
  const source = card.sources[platform];
  if (source === undefined) return null;
  return {
    platform,
    slug: source.slug,
    title: card.title,
    difficulty: source.difficulty === "Unknown" ? card.difficulty : source.difficulty,
    frontendId: source.frontendId,
    listSlug: source.listSlug,
    metaIncomplete: card.metaIncomplete === true,
  };
}

function parseLogEntry(value: unknown, fallbackPlatform?: Platform): ReviewLogEntry | null {
  if (!isRecord(value) || typeof value.ts !== "string" || typeof value.scheduledDue !== "string") {
    return null;
  }
  const problemId = text(value.problemId, text(value.slug));
  const platform = validPlatform(value.platform) ? value.platform : fallbackPlatform;
  if (problemId.length === 0 || platform === undefined || !validGrade(value.grade)) return null;
  return {
    ts: value.ts,
    problemId,
    platform,
    mode: mode(value.mode),
    feel: feel(value.feel),
    grade: value.grade,
    submissionsInSession: finite(value.submissionsInSession),
    minutesInSession:
      typeof value.minutesInSession === "number" && Number.isFinite(value.minutesInSession)
        ? value.minutesInSession
        : null,
    scheduledDue: value.scheduledDue,
  };
}

function parsePending(value: unknown): PendingAccepted | null {
  if (!isRecord(value) || !isRecord(value.problem) || typeof value.problemId !== "string") return null;
  const problem = value.problem;
  if (!validPlatform(problem.platform) || typeof problem.slug !== "string") return null;
  return {
    problemId: value.problemId,
    problem: {
      platform: problem.platform,
      slug: problem.slug,
      title: text(problem.title, problem.slug),
      difficulty: difficulty(problem.difficulty),
      frontendId: nullableText(problem.frontendId),
      listSlug: nullableText(problem.listSlug),
      metaIncomplete: problem.metaIncomplete === true,
    },
    submissionsInSession: finite(value.submissionsInSession),
    minutesInSession:
      typeof value.minutesInSession === "number" && Number.isFinite(value.minutesInSession)
        ? value.minutesInSession
        : null,
    acceptedAt: text(value.acceptedAt, new Date().toISOString()),
  };
}

function parseV2(raw: Record<string, unknown>): ParsedBackup {
  if (!isRecord(raw.cards) || !Array.isArray(raw.log)) {
    throw new Error("Sauvegarde invalide : cartes ou historique manquants.");
  }
  const cards = Object.entries(raw.cards).map(([key, value]) => {
    const card = parseV2Card(key, value);
    if (card === null) throw new Error(`Sauvegarde invalide : carte « ${key} » illisible.`);
    return { aliases: [key, card.id], card };
  });
  const log = raw.log.flatMap((value) => {
    const entry = parseLogEntry(value);
    return entry === null ? [] : [entry];
  });
  return {
    cards,
    log,
    settings: isRecord(raw.settings) ? raw.settings : null,
    pendingAccepted: parsePending(raw.pendingAccepted),
  };
}

function parseLegacyPending(
  value: unknown,
  cards: Array<{ aliases: string[]; card: ProblemCard }>,
): PendingAccepted | null {
  if (!isRecord(value) || typeof value.slug !== "string") return null;
  const slug = value.slug;
  const matched = cards.find((item) => item.aliases.includes(slug));
  const matchedCard = matched?.card;
  const platform: Platform = "lcDifficulty" in value ? "leetcode" : "neetcode";
  const source = matchedCard?.sources[platform];
  const problem: ProblemDescriptor = source === undefined || matchedCard === undefined
    ? {
        platform,
        slug: value.slug,
        title: text(value.title, value.slug),
        difficulty: difficulty(value.lcDifficulty ?? value.ncDifficulty),
        frontendId: nullableText(value.frontendId),
        listSlug: nullableText(value.listSlug),
        metaIncomplete: false,
      }
    : {
        platform,
        slug: source.slug,
        title: matchedCard.title,
        difficulty: matchedCard.difficulty,
        frontendId: source.frontendId,
        listSlug: source.listSlug,
        metaIncomplete: matchedCard.metaIncomplete === true,
      };
  return {
    problemId: matched?.card.id ?? preferredProblemId(problem),
    problem,
    submissionsInSession: finite(value.submissionsInSession),
    minutesInSession:
      typeof value.minutesInSession === "number" && Number.isFinite(value.minutesInSession)
        ? value.minutesInSession
        : null,
    acceptedAt: text(value.acceptedAt, new Date().toISOString()),
  };
}

function parseLegacy(raw: Record<string, unknown>): ParsedBackup {
  if (!isRecord(raw.cards) || !Array.isArray(raw.log)) {
    throw new Error("Sauvegarde historique invalide : cartes ou historique manquants.");
  }
  const cards = Object.entries(raw.cards).flatMap(([key, value]) => {
    const card = legacyCard(key, value);
    return card === null ? [] : [card];
  });
  const platformByAlias = new Map<string, Platform>();
  for (const item of cards) {
    const platform: Platform = item.card.sources.leetcode === undefined ? "neetcode" : "leetcode";
    for (const alias of item.aliases) platformByAlias.set(alias, platform);
  }
  const log = raw.log.flatMap((value) => {
    const alias = isRecord(value) ? text(value.slug, text(value.problemId)) : "";
    const entry = parseLogEntry(value, platformByAlias.get(alias));
    return entry === null ? [] : [entry];
  });
  return {
    cards,
    log,
    settings: isRecord(raw.settings) ? raw.settings : null,
    pendingAccepted: parseLegacyPending(raw.pendingAccepted, cards),
  };
}

function newestSource(left: ProblemSource | undefined, right: ProblemSource | undefined): ProblemSource | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return right.lastSeenAt > left.lastSeenAt ? right : left;
}

function mergeCards(existing: ProblemCard, imported: ProblemCard, id: string): ProblemCard {
  const newest = imported.updatedAt > existing.updatedAt ? imported : existing;
  const title = existing.sources.leetcode !== undefined && imported.sources.leetcode === undefined
    ? existing.title
    : imported.sources.leetcode !== undefined && existing.sources.leetcode === undefined
      ? imported.title
      : newest.title;
  const leetcode = newestSource(existing.sources.leetcode, imported.sources.leetcode);
  const neetcode = newestSource(existing.sources.neetcode, imported.sources.neetcode);
  const sources: ProblemCard["sources"] = {};
  if (leetcode !== undefined) sources.leetcode = leetcode;
  if (neetcode !== undefined) sources.neetcode = neetcode;
  return {
    ...newest,
    id,
    title,
    sources,
    createdAt: existing.createdAt < imported.createdAt ? existing.createdAt : imported.createdAt,
    updatedAt: existing.updatedAt > imported.updatedAt ? existing.updatedAt : imported.updatedAt,
    ...(existing.metaIncomplete === true && imported.metaIncomplete === true
      ? { metaIncomplete: true }
      : { metaIncomplete: undefined }),
  };
}

function mergeSettings(current: Settings, imported: Record<string, unknown> | null): Settings {
  if (imported === null) return current;
  const next = { ...current };
  if (typeof imported.reviewCooldownHours === "number" && Number.isFinite(imported.reviewCooldownHours)) {
    next.reviewCooldownHours = imported.reviewCooldownHours;
  }
  if (typeof imported.requestRetention === "number" && Number.isFinite(imported.requestRetention)) {
    next.requestRetention = imported.requestRetention;
  }
  if (typeof imported.maximumIntervalDays === "number" && Number.isFinite(imported.maximumIntervalDays)) {
    next.maximumIntervalDays = imported.maximumIntervalDays;
  }
  if (typeof imported.arracheCountsAsAgain === "boolean") {
    next.arracheCountsAsAgain = imported.arracheCountsAsAgain;
  }
  return next;
}

function logKey(entry: ReviewLogEntry): string {
  return [entry.problemId, entry.ts, entry.platform, entry.mode, entry.feel, entry.grade].join("\u0000");
}

/** Fusionne une sauvegarde v2 ou l'export v1 de l'une des anciennes extensions. */
export function mergeBackup(data: unknown, current: BackupSnapshot): {
  snapshot: BackupSnapshot;
  summary: ImportSummary;
} {
  const rawValue = typeof data === "string" ? JSON.parse(data) as unknown : data;
  if (!isRecord(rawValue)) throw new Error("Sauvegarde invalide : objet JSON attendu.");
  const version = finite(rawValue.schemaVersion, 1);
  if (version !== 1 && version !== 2) {
    throw new Error(`Version de sauvegarde non prise en charge : ${version}.`);
  }
  const parsed = version === 2 ? parseV2(rawValue) : parseLegacy(rawValue);
  const cards = { ...current.cards };
  const idMap = new Map<string, string>();
  const added = new Set<string>();
  const updated = new Set<string>();

  for (const item of parsed.cards) {
    const descriptors = (["leetcode", "neetcode"] as const)
      .map((platform) => descriptorFromSource(item.card, platform))
      .filter((value): value is ProblemDescriptor => value !== null);
    const targetId =
      descriptors.map((descriptor) => findExistingProblemId(cards, descriptor)).find((id) => id !== null) ??
      (cards[item.card.id] === undefined ? null : item.card.id) ??
      (descriptors[0] === undefined ? item.card.id : preferredProblemId(descriptors[0]));
    const existing = cards[targetId];
    cards[targetId] = existing === undefined
      ? { ...item.card, id: targetId }
      : mergeCards(existing, item.card, targetId);
    if (existing === undefined) added.add(targetId);
    else if (!added.has(targetId)) updated.add(targetId);
    for (const alias of item.aliases) idMap.set(alias, targetId);
    idMap.set(item.card.id, targetId);
  }

  const existingLogKeys = new Set(current.log.map(logKey));
  const log = [...current.log];
  let logEntriesAdded = 0;
  for (const rawEntry of parsed.log) {
    const entry = { ...rawEntry, problemId: idMap.get(rawEntry.problemId) ?? rawEntry.problemId };
    const key = logKey(entry);
    if (existingLogKeys.has(key)) continue;
    existingLogKeys.add(key);
    log.push(entry);
    logEntriesAdded += 1;
  }
  log.sort((left, right) => left.ts.localeCompare(right.ts));

  const importedPending = parsed.pendingAccepted === null
    ? null
    : {
        ...parsed.pendingAccepted,
        problemId:
          idMap.get(parsed.pendingAccepted.problemId) ?? parsed.pendingAccepted.problemId,
      };
  const pendingAccepted = importedPending !== null &&
      (current.pendingAccepted === null || importedPending.acceptedAt > current.pendingAccepted.acceptedAt)
    ? importedPending
    : current.pendingAccepted;

  return {
    snapshot: {
      schemaVersion: current.schemaVersion,
      cards,
      log,
      settings: mergeSettings(current.settings, parsed.settings),
      pendingAccepted,
    },
    summary: {
      cardsAdded: added.size,
      cardsUpdated: updated.size,
      logEntriesAdded,
    },
  };
}
