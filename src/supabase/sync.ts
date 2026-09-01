import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { browser } from "wxt/browser";
import {
  getAllData,
  getSupabaseSyncMeta,
  replaceFsrsData,
  SCHEMA_VERSION,
  setSupabaseSyncMeta,
  type StorageShape,
} from "../storage";
import type {
  PendingAccepted,
  Platform,
  ProblemCard,
  ProblemSource,
  ReviewLogEntry,
  SupabaseSyncStatus,
} from "../types";
import {
  activeSupabaseSession,
  discardPersistedProviderTokens,
  getSupabaseClient,
  supabaseOAuthRedirectUrl,
} from "./client";
import { SUPABASE_AVAILABLE, SUPABASE_TABLE } from "./config";
import { parseOAuthCallback } from "./oauth";
import {
  publicSupabaseStatus,
  type SupabaseSyncMeta,
} from "./types";

interface RemoteSnapshotRow {
  user_id: string;
  schema_version: number;
  data: unknown;
  client_updated_at: string;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validDifficulty(value: unknown): boolean {
  return value === "Easy" || value === "Medium" || value === "Hard" || value === "Unknown";
}

function validSource(value: unknown): value is ProblemSource {
  return (
    isRecord(value) &&
    typeof value.slug === "string" &&
    (value.frontendId === null || typeof value.frontendId === "string") &&
    (value.listSlug === null || typeof value.listSlug === "string") &&
    validDifficulty(value.difficulty) &&
    validDate(value.lastSeenAt)
  );
}

function validCard(value: unknown): value is ProblemCard {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    validDifficulty(value.difficulty) &&
    isRecord(value.sources) &&
    Object.entries(value.sources).every(
      ([platform, source]) =>
        (platform === "leetcode" || platform === "neetcode") && validSource(source),
    ) &&
    isRecord(value.fsrs) &&
    validDate(value.fsrs.due) &&
    typeof value.fsrs.stability === "number" &&
    typeof value.fsrs.difficulty === "number" &&
    typeof value.fsrs.reps === "number" &&
    typeof value.fsrs.lapses === "number" &&
    typeof value.fsrs.state === "number" &&
    (value.fsrs.last_review === null || validDate(value.fsrs.last_review)) &&
    (value.lastMode === "seul" || value.lastMode === "aide" || value.lastMode === "abandon") &&
    (value.lastFeel === null || [1, 2, 3, 4].includes(value.lastFeel as number)) &&
    validDate(value.createdAt) &&
    validDate(value.updatedAt)
  );
}

function validPendingAccepted(value: unknown): value is PendingAccepted {
  if (!isRecord(value) || !isRecord(value.problem)) return false;
  const problem = value.problem;
  return (
    typeof value.problemId === "string" &&
    validDate(value.acceptedAt) &&
    typeof value.submissionsInSession === "number" &&
    (value.minutesInSession === null || typeof value.minutesInSession === "number") &&
    (problem.platform === "leetcode" || problem.platform === "neetcode") &&
    typeof problem.slug === "string" &&
    typeof problem.title === "string" &&
    validDifficulty(problem.difficulty) &&
    (problem.frontendId === null || typeof problem.frontendId === "string") &&
    (problem.listSlug === null || typeof problem.listSlug === "string") &&
    typeof problem.metaIncomplete === "boolean"
  );
}

function validLogEntry(value: unknown): value is ReviewLogEntry {
  return (
    isRecord(value) &&
    validDate(value.ts) &&
    typeof value.problemId === "string" &&
    (value.platform === "leetcode" || value.platform === "neetcode") &&
    (value.mode === "seul" || value.mode === "aide" || value.mode === "abandon") &&
    (value.feel === null || [1, 2, 3, 4].includes(value.feel as number)) &&
    [1, 2, 3, 4].includes(value.grade as number) &&
    typeof value.submissionsInSession === "number" &&
    (value.minutesInSession === null || typeof value.minutesInSession === "number") &&
    validDate(value.scheduledDue)
  );
}

function validSettings(value: unknown): value is StorageShape["settings"] {
  return (
    isRecord(value) &&
    typeof value.reviewCooldownHours === "number" &&
    typeof value.requestRetention === "number" &&
    typeof value.maximumIntervalDays === "number" &&
    typeof value.arracheCountsAsAgain === "boolean" &&
    (value.bannerSnoozedUntil === null || validDate(value.bannerSnoozedUntil))
  );
}

function validRemoteSnapshot(value: unknown): value is StorageShape {
  if (!isRecord(value) || value.schemaVersion !== SCHEMA_VERSION) return false;
  if (
    !isRecord(value.cards) ||
    !Object.entries(value.cards).every(
      ([id, card]) => validCard(card) && card.id === id,
    )
  ) return false;
  if (!Array.isArray(value.log) || !value.log.every(validLogEntry)) return false;
  if (!validSettings(value.settings)) return false;
  return value.pendingAccepted === null || validPendingAccepted(value.pendingAccepted);
}

function newerSource(
  left: ProblemSource | undefined,
  right: ProblemSource | undefined,
): ProblemSource | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return left.lastSeenAt >= right.lastSeenAt ? left : right;
}

function mergeCard(left: ProblemCard, right: ProblemCard): ProblemCard {
  const newest = left.updatedAt >= right.updatedAt ? left : right;
  const oldest = newest === left ? right : left;
  const metadata =
    newest.metaIncomplete !== true
      ? newest
      : oldest.metaIncomplete !== true
        ? oldest
        : newest;
  const complete = left.metaIncomplete !== true || right.metaIncomplete !== true;
  const sources: ProblemCard["sources"] = {};
  for (const platform of ["leetcode", "neetcode"] as const satisfies readonly Platform[]) {
    const source = newerSource(left.sources[platform], right.sources[platform]);
    if (source !== undefined) sources[platform] = source;
  }
  const { metaIncomplete: _ignored, ...base } = newest;
  return {
    ...base,
    title: metadata.title,
    difficulty: metadata.difficulty,
    sources,
    ...(!complete ? { metaIncomplete: true } : {}),
    createdAt: left.createdAt <= right.createdAt ? left.createdAt : right.createdAt,
  };
}

function logKey(entry: ReviewLogEntry): string {
  return JSON.stringify([
    entry.ts,
    entry.problemId,
    entry.platform,
    entry.mode,
    entry.feel,
    entry.grade,
    entry.submissionsInSession,
    entry.minutesInSession,
    entry.scheduledDue,
  ]);
}

/** Fusion pure utilisee aussi par les tests. */
export function mergeSnapshots(
  local: StorageShape,
  remote: StorageShape,
  preferLocalVolatile: boolean,
): StorageShape {
  const cards: Record<string, ProblemCard> = { ...remote.cards };
  for (const [id, localCard] of Object.entries(local.cards)) {
    const remoteCard = cards[id];
    cards[id] = remoteCard === undefined ? localCard : mergeCard(localCard, remoteCard);
  }

  const log = new Map<string, ReviewLogEntry>();
  for (const entry of [...remote.log, ...local.log]) log.set(logKey(entry), entry);

  return {
    schemaVersion: SCHEMA_VERSION,
    cards,
    log: [...log.values()].sort((left, right) => left.ts.localeCompare(right.ts)),
    settings: preferLocalVolatile ? local.settings : remote.settings,
    pendingAccepted: preferLocalVolatile
      ? local.pendingAccepted
      : remote.pendingAccepted,
  };
}

function hasUserData(data: StorageShape): boolean {
  return (
    Object.keys(data.cards).length > 0 ||
    data.log.length > 0 ||
    data.pendingAccepted !== null
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function storeSyncError(error: unknown): Promise<void> {
  const meta = await getSupabaseSyncMeta();
  await setSupabaseSyncMeta({ ...meta, lastError: errorMessage(error) });
}

async function requireAccountOwnership(
  session: Session,
  data: StorageShape,
): Promise<SupabaseSyncMeta> {
  const meta = await getSupabaseSyncMeta();
  if (
    meta.ownerUserId !== null &&
    meta.ownerUserId !== session.user.id &&
    hasUserData(data)
  ) {
    throw new Error(
      "Ces données locales sont déjà liées à un autre compte Supabase. " +
        "Réutilisez ce compte afin d'éviter de copier ses données vers un tiers.",
    );
  }
  return {
    ...meta,
    ownerUserId: session.user.id,
    ownerEmail: session.user.email ?? null,
  };
}

async function currentSession(client: SupabaseClient): Promise<Session | null> {
  try {
    return await activeSupabaseSession(client);
  } catch (error) {
    await storeSyncError(error);
    return null;
  }
}

function githubLogin(session: Session): string | null {
  const metadata = session.user.user_metadata;
  for (const key of ["user_name", "preferred_username", "login"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export async function getSupabaseSyncStatus(): Promise<SupabaseSyncStatus> {
  const meta = await getSupabaseSyncMeta();
  const client = getSupabaseClient();
  const redirectUrl = supabaseOAuthRedirectUrl();
  if (client === null) {
    return publicSupabaseStatus(meta, false, false, null, null, redirectUrl);
  }
  const session = await currentSession(client);
  return publicSupabaseStatus(
    await getSupabaseSyncMeta(),
    true,
    session !== null,
    session?.user.email ?? null,
    session === null ? null : githubLogin(session),
    redirectUrl,
  );
}

async function synchronizeWithSession(
  client: SupabaseClient,
  session: Session,
): Promise<SupabaseSyncStatus> {
  const local = await getAllData();
  let meta = await requireAccountOwnership(session, local);
  await setSupabaseSyncMeta(meta);

  const selected = await client
    .from(SUPABASE_TABLE)
    .select("user_id,schema_version,data,client_updated_at,updated_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (selected.error !== null) throw selected.error;

  const row = selected.data as RemoteSnapshotRow | null;
  let merged = local;
  let shouldUpload = row === null;
  if (row !== null) {
    if (row.schema_version !== SCHEMA_VERSION || !validRemoteSnapshot(row.data)) {
      throw new Error(
        `Le snapshot Supabase utilise un schéma incompatible (${row.schema_version}).`,
      );
    }
    const dirtyAt = meta.dirtyAt === null ? 0 : Date.parse(meta.dirtyAt);
    const remoteAt = Date.parse(row.client_updated_at);
    merged = mergeSnapshots(local, row.data, meta.dirty && dirtyAt >= remoteAt);
    shouldUpload = meta.dirty || JSON.stringify(merged) !== JSON.stringify(row.data);
  }

  const syncedAt = new Date().toISOString();
  if (shouldUpload) {
    const saved = await client.from(SUPABASE_TABLE).upsert(
      {
        user_id: session.user.id,
        schema_version: SCHEMA_VERSION,
        data: merged,
        client_updated_at: syncedAt,
        updated_at: syncedAt,
      },
      { onConflict: "user_id" },
    );
    if (saved.error !== null) throw saved.error;
  }

  await replaceFsrsData(merged);
  meta = {
    ...meta,
    dirty: false,
    dirtyAt: null,
    lastSyncAt: syncedAt,
    lastError: null,
  };
  await setSupabaseSyncMeta(meta);
  return publicSupabaseStatus(
    meta,
    true,
    true,
    session.user.email ?? null,
    githubLogin(session),
    supabaseOAuthRedirectUrl(),
  );
}

export async function synchronizeSupabase(
  requireSession = true,
): Promise<SupabaseSyncStatus> {
  const client = getSupabaseClient();
  if (client === null) {
    const meta = await getSupabaseSyncMeta();
    if (requireSession) throw new Error("Supabase n'est pas configuré dans ce build.");
    return publicSupabaseStatus(
      meta,
      false,
      false,
      null,
      null,
      supabaseOAuthRedirectUrl(),
    );
  }
  const session = await currentSession(client);
  if (session === null) {
    if (requireSession) throw new Error("Connectez d'abord votre compte Supabase.");
    return getSupabaseSyncStatus();
  }
  try {
    return await synchronizeWithSession(client, session);
  } catch (error) {
    await storeSyncError(error);
    throw error;
  }
}

function requiredClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (client === null) throw new Error("Supabase n'est pas configuré dans ce build.");
  return client;
}

export async function signInSupabaseWithGithub(): Promise<SupabaseSyncStatus> {
  const client = requiredClient();
  const redirectTo = supabaseOAuthRedirectUrl();
  const started = await client.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });
  if (started.error !== null) throw started.error;
  if (started.data.url === null) throw new Error("URL OAuth GitHub absente.");

  const callbackUrl = await browser.identity.launchWebAuthFlow({
    url: started.data.url,
    interactive: true,
  });
  if (callbackUrl === undefined) {
    throw new Error("Connexion GitHub annulée avant la redirection.");
  }
  const callback = parseOAuthCallback(
    callbackUrl,
    redirectTo,
    started.data.flowId ?? null,
  );
  const exchanged = await client.auth.exchangeCodeForSession(
    callback.code,
    callback.flowId === null ? undefined : { flowId: callback.flowId },
  );
  if (exchanged.error !== null) throw exchanged.error;
  await discardPersistedProviderTokens();
  if (exchanged.data.session === null) throw new Error("Session Supabase absente.");
  return synchronizeAfterAuthentication(client, exchanged.data.session);
}

async function synchronizeAfterAuthentication(
  client: SupabaseClient,
  session: Session,
): Promise<SupabaseSyncStatus> {
  try {
    return await synchronizeWithSession(client, session);
  } catch (error) {
    const data = await getAllData();
    const meta = await getSupabaseSyncMeta();
    if (
      meta.ownerUserId !== null &&
      meta.ownerUserId !== session.user.id &&
      hasUserData(data)
    ) {
      await client.auth.signOut({ scope: "local" });
    }
    await storeSyncError(error);
    throw error;
  }
}

export async function signOutSupabase(): Promise<SupabaseSyncStatus> {
  const client = requiredClient();
  const result = await client.auth.signOut({ scope: "local" });
  if (result.error !== null) throw result.error;
  const meta = await getSupabaseSyncMeta();
  await setSupabaseSyncMeta({ ...meta, lastError: null });
  return publicSupabaseStatus(
    { ...meta, lastError: null },
    SUPABASE_AVAILABLE,
    false,
    null,
    null,
    supabaseOAuthRedirectUrl(),
  );
}
