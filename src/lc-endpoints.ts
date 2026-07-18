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

/** Le frontend actuel charge le verdict détaillé via cette route GraphQL. */
export function isGraphqlEndpoint(url: string): boolean {
  const pathname = pathnameFor(url);
  return pathname === "/graphql" || pathname === "/graphql/";
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

/**
 * Extrait uniquement la variable de métadonnée `submissionId` d'une requête
 * GraphQL. Une mutation qui contient le code est explicitement ignorée : le
 * code utilisateur n'est ni lu, ni stocké, ni journalisé par l'extension.
 */
export function submissionIdFromGraphqlRequestBody(body: unknown): string | null {
  if (typeof body !== "string") return null;
  if (/"(?:typedCode|typed_code|code)"\s*:/.test(body)) return null;
  const match = /"(?:submissionId|submission_id)"\s*:\s*"?(\d+)"?/.exec(body);
  return match === null ? null : normalizeSubmissionId(match[1]);
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

/**
 * LeetCode moderne demande `submissionDetails(submissionId)` via GraphQL.
 * Son UI considère `statusCode === 10` comme l'Accepted ; le payload ne
 * contient pas systématiquement l'ancien couple status_msg/status_code.
 * La recherche est volontairement limitée aux enveloppes de verdict connues,
 * afin de ne jamais parcourir un éventuel champ de code de réponse.
 */
export function acceptedVerdictFromGraphqlResponse(response: unknown): CheckResponse | null {
  const containerKeys = [
    "data",
    "submissionDetails",
    "submissionDetail",
    "submission",
    "submitResult",
    "result",
  ] as const;

  function visit(value: unknown, depth: number): CheckResponse | null {
    if (depth > 5) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    if (!isRecord(value)) return null;

    const statusCode = numericStatusCode(value.statusCode ?? value.status_code);
    if (statusCode === STATUS_CODE_ACCEPTED) {
      return {
        state: CHECK_STATE_FINAL,
        status_msg: STATUS_MSG_ACCEPTED,
        status_code: statusCode,
      };
    }

    for (const key of containerKeys) {
      const found = visit(value[key], depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  return visit(response, 0);
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

/**
 * Contexte de liste/Study Plan exposé par LeetCode, par exemple :
 * ?envType=study-plan-v2&envId=top-interview-150
 */
export function collectionSlugFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  const envType = params.get("envType")?.trim();
  const envId = params.get("envId")?.trim().toLowerCase();
  if (!envType || !envId || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(envId)) return null;
  return envId;
}
