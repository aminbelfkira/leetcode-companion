// Modèle de données commun à LeetCode et NeetCode, protocole runtime et
// événements relayés depuis le monde MAIN.

import type {
  AcceptedSubmissionForSync,
  GithubDeviceFlowPoll,
  GithubDeviceFlowStart,
  GithubRepository,
  GithubSyncStatus,
} from "./github/types";

export type Platform = "leetcode" | "neetcode";
export type Mode = "seul" | "aide" | "abandon";
export type Feel = 1 | 2 | 3 | 4;
export type Difficulty = "Easy" | "Medium" | "Hard" | "Unknown";

export interface FsrsState {
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
}

/** Métadonnées observées sur l'un des deux sites. */
export interface ProblemDescriptor {
  platform: Platform;
  slug: string;
  title: string;
  difficulty: Difficulty;
  frontendId: string | null;
  listSlug: string | null;
  metaIncomplete: boolean;
}

export interface ProblemSource {
  slug: string;
  frontendId: string | null;
  listSlug: string | null;
  difficulty: Difficulty;
  lastSeenAt: string;
}

/** Une seule carte de révision, éventuellement reliée aux deux plateformes. */
export interface ProblemCard {
  id: string;
  title: string;
  difficulty: Difficulty;
  sources: Partial<Record<Platform, ProblemSource>>;
  metaIncomplete?: boolean;
  lastMode: Mode;
  lastFeel: Feel | null;
  fsrs: FsrsState;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLogEntry {
  ts: string;
  problemId: string;
  platform: Platform;
  mode: Mode;
  feel: Feel | null;
  grade: 1 | 2 | 3 | 4;
  submissionsInSession: number;
  minutesInSession: number | null;
  scheduledDue: string;
}

export interface Settings {
  reviewCooldownHours: number;
  requestRetention: number;
  maximumIntervalDays: number;
  arracheCountsAsAgain: boolean;
  bannerSnoozedUntil: string | null;
}

export interface PendingAccepted {
  problemId: string;
  problem: ProblemDescriptor;
  submissionsInSession: number;
  minutesInSession: number | null;
  acceptedAt: string;
}

export interface ReviewInput {
  problemId: string;
  problem: ProblemDescriptor;
  mode: Mode;
  feel: Feel | null;
  submissionsInSession: number;
  minutesInSession: number | null;
}

export interface SupabaseSyncStatus {
  available: boolean;
  connected: boolean;
  email: string | null;
  userLogin: string | null;
  redirectUrl: string | null;
  dirty: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Messages runtime → background (single-writer)
// ---------------------------------------------------------------------------

export type RuntimeRequest =
  | { kind: "STORAGE_READY" }
  | { kind: "PREPARE_ACCEPTED"; problem: ProblemDescriptor }
  | { kind: "CHECK_COOLDOWN"; problemId: string }
  | { kind: "PREVIEW_REVIEW"; problemId: string; mode: Mode; feel: Feel | null }
  | { kind: "LOG_REVIEW"; review: ReviewInput }
  | { kind: "SET_PENDING_ACCEPTED"; pending: PendingAccepted }
  | { kind: "CLEAR_PENDING_ACCEPTED" }
  | { kind: "SNOOZE_BANNER" }
  | { kind: "SUPABASE_GET_STATUS" }
  | { kind: "SUPABASE_SIGN_IN_GITHUB" }
  | { kind: "SUPABASE_SIGN_OUT" }
  | { kind: "SUPABASE_SYNC_NOW" }
  | { kind: "GITHUB_GET_STATUS" }
  | { kind: "GITHUB_START_DEVICE_FLOW" }
  | { kind: "GITHUB_POLL_DEVICE_FLOW" }
  | { kind: "GITHUB_LIST_REPOSITORIES" }
  | { kind: "GITHUB_SELECT_REPOSITORY"; repositoryId: number }
  | { kind: "GITHUB_DISCONNECT" }
  | { kind: "GITHUB_RETRY_QUEUE" }
  | { kind: "GITHUB_SYNC_SUBMISSION"; submission: AcceptedSubmissionForSync }
  | { kind: "UPDATE_CARD_META"; problem: ProblemDescriptor };

export interface RuntimeResponseMap {
  STORAGE_READY: { ok: true };
  PREPARE_ACCEPTED: { problemId: string; underCooldown: boolean };
  CHECK_COOLDOWN: { underCooldown: boolean };
  PREVIEW_REVIEW: { scheduledDue: string };
  LOG_REVIEW: { scheduledDue: string };
  SET_PENDING_ACCEPTED: { ok: true };
  CLEAR_PENDING_ACCEPTED: { ok: true };
  SNOOZE_BANNER: { ok: true };
  UPDATE_CARD_META: { ok: true };
  SUPABASE_GET_STATUS: SupabaseSyncStatus;
  SUPABASE_SIGN_IN_GITHUB: SupabaseSyncStatus;
  SUPABASE_SIGN_OUT: SupabaseSyncStatus;
  SUPABASE_SYNC_NOW: SupabaseSyncStatus;
  GITHUB_GET_STATUS: GithubSyncStatus;
  GITHUB_START_DEVICE_FLOW: GithubDeviceFlowStart;
  GITHUB_POLL_DEVICE_FLOW: GithubDeviceFlowPoll;
  GITHUB_LIST_REPOSITORIES: { repositories: GithubRepository[] };
  GITHUB_SELECT_REPOSITORY: GithubSyncStatus;
  GITHUB_DISCONNECT: GithubSyncStatus;
  GITHUB_RETRY_QUEUE: GithubSyncStatus;
  GITHUB_SYNC_SUBMISSION: {
    synced: boolean;
    pendingCount: number;
    path: string | null;
  };
}

export type RuntimeResponse<K extends RuntimeRequest["kind"]> =
  | RuntimeResponseMap[K]
  | { error: string };

// ---------------------------------------------------------------------------
// Événements MAIN → ISOLATED LeetCode
// ---------------------------------------------------------------------------

export interface PageEventPayloads {
  /** IDs restent des strings : aucune perte de précision si LeetCode les sérialise ainsi. */
  "submission-created": { id: string; slug: string };
  "submission-result": { id: string; statusMsg: string; statusCode: number };
  "url-change": { pathname: string };
}

export type PageEventType = keyof PageEventPayloads;

export type PageMessage = {
  [T in PageEventType]: {
    source: "lcfsrs";
    type: T;
    payload: PageEventPayloads[T];
  };
}[PageEventType];

// ---------------------------------------------------------------------------
// Événements MAIN → ISOLATED NeetCode
// ---------------------------------------------------------------------------

export interface NcPageEventPayloads {
  "submission-created": { token: string; slug: string | null };
  "submission-result": {
    token: string;
    slug: string | null;
    statusDescription: string;
    testCaseCount: number | null;
    correctTestCaseCount: number | null;
  };
  "url-change": { pathname: string; search: string };
}

export type NcPageEventType = keyof NcPageEventPayloads;

export type NcPageMessage = {
  [T in NcPageEventType]: {
    source: "lcfsrs";
    type: T;
    payload: NcPageEventPayloads[T];
  };
}[NcPageEventType];
