// Modèle de données et protocole d'événements entre les mondes de l'extension.

export type Mode = "seul" | "aide" | "abandon";
export type Feel = 1 | 2 | 3 | 4; // 1 fluide · 2 correct · 3 laborieux · 4 à l'arraché
export type Difficulty = "Easy" | "Medium" | "Hard" | "Unknown";

export interface FsrsState {
  due: string; // ISO
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number; // enum State de ts-fsrs
  last_review: string | null; // ISO
}

export interface ProblemCard {
  slug: string; // "duplicate-integer" — clé primaire
  title: string; // "Contains Duplicate"
  ncDifficulty: Difficulty;
  listSlug: string | null; // "neetcode150" si connu, informatif
  metaIncomplete?: boolean; // métadonnées issues du repli DOM
  lastMode: Mode;
  lastFeel: Feel | null; // null si mode = "abandon"
  fsrs: FsrsState;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLogEntry {
  // append-only, source de vérité
  ts: string;
  slug: string;
  mode: Mode;
  feel: Feel | null;
  grade: 1 | 2 | 3 | 4; // Rating FSRS réellement appliqué
  submissionsInSession: number;
  minutesInSession: number | null;
  scheduledDue: string; // due résultant
}

export interface Settings {
  reviewCooldownHours: number; // défaut 8
  requestRetention: number; // défaut 0.9
  maximumIntervalDays: number; // défaut 180
  arracheCountsAsAgain: boolean; // défaut false
  bannerSnoozedUntil: string | null;
}

export interface PendingAccepted {
  // Accepted détecté mais panneau fermé sans noter
  slug: string;
  title: string;
  ncDifficulty: Difficulty;
  listSlug: string | null;
  submissionsInSession: number;
  minutesInSession: number | null;
  acceptedAt: string;
}

// ---------------------------------------------------------------------------
// Messages runtime vers le background (single-writer)
// ---------------------------------------------------------------------------

/** Payload d'une review saisie (panneau, popup, abandon). */
export interface ReviewInput {
  slug: string;
  title: string;
  ncDifficulty: Difficulty;
  listSlug: string | null;
  metaIncomplete: boolean;
  mode: Mode;
  feel: Feel | null;
  submissionsInSession: number;
  minutesInSession: number | null;
}

export type RuntimeRequest =
  | { kind: "CHECK_COOLDOWN"; slug: string }
  | { kind: "PREVIEW_REVIEW"; slug: string; mode: Mode; feel: Feel | null }
  | { kind: "LOG_REVIEW"; review: ReviewInput }
  | { kind: "SET_PENDING_ACCEPTED"; pending: PendingAccepted }
  | { kind: "CLEAR_PENDING_ACCEPTED" }
  | { kind: "SNOOZE_BANNER" }
  | { kind: "SAVE_SETTINGS"; settings: Partial<Settings> }
  | {
      kind: "UPDATE_CARD_META"; // répare une carte metaIncomplete
      slug: string;
      title: string;
      ncDifficulty: Difficulty;
    };

export interface RuntimeResponseMap {
  CHECK_COOLDOWN: { underCooldown: boolean };
  PREVIEW_REVIEW: { scheduledDue: string };
  LOG_REVIEW: { scheduledDue: string };
  SET_PENDING_ACCEPTED: { ok: true };
  CLEAR_PENDING_ACCEPTED: { ok: true };
  SNOOZE_BANNER: { ok: true };
  SAVE_SETTINGS: { ok: true };
  UPDATE_CARD_META: { ok: true };
}

export type RuntimeResponse<K extends RuntimeRequest["kind"]> =
  | RuntimeResponseMap[K]
  | { error: string };

// ---------------------------------------------------------------------------
// Événements MAIN vers ISOLATED
// ---------------------------------------------------------------------------

export interface PageEventPayloads {
  /** Une soumission vient de partir. `token` corrèle le départ et le verdict. */
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
