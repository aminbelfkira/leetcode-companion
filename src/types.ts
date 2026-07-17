// Modèle de données (§6) + protocole d'événements page (§5.4).

export type Mode = "seul" | "aide" | "abandon";
export type Feel = 1 | 2 | 3 | 4; // 1 fluide · 2 correct · 3 laborieux · 4 à l'arraché

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
  slug: string; // "two-sum" — clé primaire
  frontendId: string; // "1"
  title: string; // "Two Sum"
  lcDifficulty: "Easy" | "Medium" | "Hard" | "Unknown";
  metaIncomplete?: boolean; // fallback §5.2 utilisé
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
  arracheCountsAsAgain: boolean; // défaut false (§7)
  bannerSnoozedUntil: string | null;
}

export interface PendingAccepted {
  // Accepted détecté mais panneau fermé sans noter
  slug: string;
  frontendId: string;
  title: string;
  lcDifficulty: ProblemCard["lcDifficulty"];
  submissionsInSession: number;
  minutesInSession: number | null;
  acceptedAt: string;
}

// ---------------------------------------------------------------------------
// Messages runtime → background (single-writer, §3/§4)
// ---------------------------------------------------------------------------

/** Payload d'une review saisie (panneau, popup pendingAccepted, abandon). */
export interface ReviewInput {
  slug: string;
  frontendId: string;
  title: string;
  lcDifficulty: ProblemCard["lcDifficulty"];
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
  | {
      kind: "UPDATE_CARD_META"; // §10 — répare une carte metaIncomplete
      slug: string;
      frontendId: string;
      title: string;
      lcDifficulty: ProblemCard["lcDifficulty"];
    };

export interface RuntimeResponseMap {
  CHECK_COOLDOWN: { underCooldown: boolean };
  PREVIEW_REVIEW: { scheduledDue: string };
  LOG_REVIEW: { scheduledDue: string };
  SET_PENDING_ACCEPTED: { ok: true };
  CLEAR_PENDING_ACCEPTED: { ok: true };
  SNOOZE_BANNER: { ok: true };
  UPDATE_CARD_META: { ok: true };
}

export type RuntimeResponse<K extends RuntimeRequest["kind"]> =
  | RuntimeResponseMap[K]
  | { error: string };

// ---------------------------------------------------------------------------
// Événements MAIN → ISOLATED (§5.4)
// ---------------------------------------------------------------------------

export interface PageEventPayloads {
  "submission-created": { id: number; slug: string };
  "submission-result": { id: number; statusMsg: string; statusCode: number };
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
