// Tout ce qui touche aux endpoints non documentés de leetcode.com est centralisé ici (§5, §14).
// À revalider empiriquement : voir les tests manuels de la Phase 1.

export const LC_ORIGIN = "https://leetcode.com";

/** POST /problems/{slug}/submit/ → { submission_id: number } — vraie soumission. */
export const SUBMIT_URL_RE =
  /^(?:https?:\/\/leetcode\.com)?\/problems\/([^/]+)\/submit\/?(?:\?.*)?$/;

/**
 * GET /submissions/detail/{id}/check/ — pollé pour le verdict.
 * Aussi utilisé par « Run » (via interpret_solution) avec un autre id :
 * seuls les ids issus d'un vrai submit doivent être traités (§5.1).
 */
export const CHECK_URL_RE =
  /^(?:https?:\/\/leetcode\.com)?\/submissions\/detail\/([^/]+)\/check\/?(?:\?.*)?$/;

/** Pages problème : /problems/{slug}/... */
export const PROBLEM_PATH_RE = /^\/problems\/([^/]+)(?:\/|$)/;

export const GRAPHQL_URL = `${LC_ORIGIN}/graphql/`;

/** Réponse de check/ : verdict final quand state === "SUCCESS". */
export const CHECK_STATE_FINAL = "SUCCESS";
/** Accepted = status_msg === "Accepted", recoupé avec status_code === 10. */
export const STATUS_MSG_ACCEPTED = "Accepted";
export const STATUS_CODE_ACCEPTED = 10;

export interface CheckResponse {
  state?: unknown;
  status_msg?: unknown;
  status_code?: unknown;
  question_id?: string;
  lang?: string;
  /** Variante observée sur certaines réponses historiques. */
  finished?: unknown;
}

export interface SubmitResponse {
  submission_id?: unknown;
  data?: { submission_id?: unknown };
}

export interface SubmitEndpoint {
  slug: string;
}

export interface CheckEndpoint {
  id: string;
}

/**
 * Normalise les URLs absolues et relatives avant matching. LeetCode a servi
 * les deux formes selon les clients et transports réseau.
 */
function pathnameFor(url: string): string | null {
  try {
    return new URL(url, LC_ORIGIN).pathname;
  } catch {
    return null;
  }
}

/** Version tolérante du matching du POST submit, sans élargir le périmètre. */
export function parseSubmitEndpoint(url: string): SubmitEndpoint | null {
  const pathname = pathnameFor(url);
  const match = pathname === null ? null : /^\/problems\/([^/]+)\/submit\/?$/.exec(pathname);
  const slug = match?.[1];
  return slug === undefined ? null : { slug };
}

/** Version tolérante du matching du poll de verdict. */
export function parseCheckEndpoint(url: string): CheckEndpoint | null {
  const pathname = pathnameFor(url);
  const match =
    pathname === null ? null : /^\/submissions\/detail\/([^/]+)\/check\/?$/.exec(pathname);
  const id = match?.[1];
  return id === undefined ? null : { id: normalizeSubmissionId(id) ?? id };
}

/**
 * LeetCode documente un nombre, mais certaines couches de transport
 * sérialisent les ids en string. On les accepte sans précision perdue.
 */
export function normalizeSubmissionId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return trimmed.replace(/^0+(?=\d)/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extrait l'id quel que soit l'enveloppage JSON de la réponse de submit. */
export function submissionIdFromResponse(response: SubmitResponse | null): string | null {
  if (response === null || !isRecord(response)) return null;
  const direct = normalizeSubmissionId(response.submission_id);
  if (direct !== null) return direct;
  return isRecord(response.data) ? normalizeSubmissionId(response.data.submission_id) : null;
}

/** Le verdict terminal peut être encodé par state ou par finished selon la réponse. */
export function isFinalCheckResponse(response: CheckResponse): boolean {
  return (
    (typeof response.state === "string" && response.state.trim().toUpperCase() === CHECK_STATE_FINAL) ||
    response.finished === true
  );
}

function numericStatusCode(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^\s*-?\d+\s*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalise le payload relayé à l'autre monde de l'extension. */
export function statusCodeForEvent(value: unknown): number {
  return numericStatusCode(value) ?? -1;
}

export function statusMessageForEvent(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepted = libellé + code, conformément à la règle de recoupement §5.1. */
export function isAcceptedVerdict(statusMsg: unknown, statusCode: unknown): boolean {
  return (
    typeof statusMsg === "string" &&
    statusMsg.trim().toLowerCase() === STATUS_MSG_ACCEPTED.toLowerCase() &&
    numericStatusCode(statusCode) === STATUS_CODE_ACCEPTED
  );
}

export function problemSlugFromPathname(pathname: string): string | null {
  const m = PROBLEM_PATH_RE.exec(pathname);
  return m?.[1] ?? null;
}
