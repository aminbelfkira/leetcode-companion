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
