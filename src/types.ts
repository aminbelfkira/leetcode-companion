// Modèle de données commun à LeetCode et NeetCode.

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
  automaticBackupEnabled: boolean;
  automaticBackupDirectoryName: string | null;
  automaticBackupLastAt: string | null;
  automaticBackupLastError: string | null;
}

export interface BackupSnapshot {
  schemaVersion: number;
  cards: Record<string, ProblemCard>;
  log: ReviewLogEntry[];
  settings: Settings;
  pendingAccepted: PendingAccepted | null;
}

export interface ImportSummary {
  cardsAdded: number;
  cardsUpdated: number;
  logEntriesAdded: number;
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

export type RuntimeRequest =
  | { kind: "PREPARE_ACCEPTED"; problem: ProblemDescriptor }
  | { kind: "CHECK_COOLDOWN"; problemId: string }
  | { kind: "PREVIEW_REVIEW"; problemId: string; mode: Mode; feel: Feel | null }
  | { kind: "LOG_REVIEW"; review: ReviewInput }
  | { kind: "SET_PENDING_ACCEPTED"; pending: PendingAccepted }
  | { kind: "CLEAR_PENDING_ACCEPTED" }
  | { kind: "SNOOZE_BANNER" }
  | { kind: "SAVE_SETTINGS"; settings: Partial<Settings> }
  | { kind: "IMPORT_BACKUP"; data: unknown }
  | { kind: "WRITE_BACKUP_NOW" }
  | { kind: "UPDATE_CARD_META"; problem: ProblemDescriptor };

export interface RuntimeResponseMap {
  PREPARE_ACCEPTED: { problemId: string; underCooldown: boolean };
  CHECK_COOLDOWN: { underCooldown: boolean };
  PREVIEW_REVIEW: { scheduledDue: string };
  LOG_REVIEW: { scheduledDue: string };
  SET_PENDING_ACCEPTED: { ok: true };
  CLEAR_PENDING_ACCEPTED: { ok: true };
  SNOOZE_BANNER: { ok: true };
  SAVE_SETTINGS: { ok: true };
  IMPORT_BACKUP: ImportSummary;
  WRITE_BACKUP_NOW: { filename: string };
  UPDATE_CARD_META: { ok: true };
}

export type RuntimeResponse<K extends RuntimeRequest["kind"]> =
  | RuntimeResponseMap[K]
  | { error: string };

// Événements MAIN -> ISOLATED de NeetCode.
export interface PageEventPayloads {
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

export type PageEventType = keyof PageEventPayloads;
export type PageMessage = {
  [T in PageEventType]: {
    source: "nccfsrs";
    type: T;
    payload: PageEventPayloads[T];
  };
}[PageEventType];

// Événements MAIN -> ISOLATED de LeetCode.
export interface LcPageEventPayloads {
  "submission-created": { id: string; slug: string };
  "submission-result": { id: string; statusMsg: string; statusCode: number };
  "url-change": { pathname: string };
}

export type LcPageEventType = keyof LcPageEventPayloads;
export type LcPageMessage = {
  [T in LcPageEventType]: {
    source: "nccfsrs";
    type: T;
    payload: LcPageEventPayloads[T];
  };
}[LcPageEventType];
