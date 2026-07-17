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
  state?: string;
  status_msg?: string;
  status_code?: number;
  question_id?: string;
  lang?: string;
}

export interface SubmitResponse {
  submission_id?: number;
}

export function problemSlugFromPathname(pathname: string): string | null {
  const m = PROBLEM_PATH_RE.exec(pathname);
  return m?.[1] ?? null;
}
