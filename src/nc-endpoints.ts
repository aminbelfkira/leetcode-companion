// Tout ce qui touche aux URLs et aux endpoints non documentés de neetcode.io est
// centralisé ici. Ces fonctions sont pures : elles portent la totalité de la
// logique de détection et constituent la surface testée par tests/.

import type { Difficulty } from "./types";

export const NC_ORIGIN = "https://neetcode.io";

/** Soumission d'un problème de code : un aller-retour, verdict compris. */
export const SUBMIT_PATH = "/api/executeCodeFunctionHttp";
/** Problèmes SQL : `runOnly` départage la soumission du simple « Run ». */
export const SQL_PATH = "/api/runSqlFunctionHttp";
/** Bouton « Run » d'un problème de code : jamais une soumission. */
export const RUN_PATH = "/api/runCodeFunctionHttp";
/** Métadonnées du problème (titre, difficulté). */
export const METADATA_PATH = "/api/getProblemMetadataFunctionHttp";

/** Au-delà, on ne tente pas de lire le corps : il ne contient que du code. */
const MAX_BODY_BYTES = 4_000_000;

/** Pages problème : /problems/{slug}, /problems/{slug}/question, … */
const PROBLEM_PATH_RE = /^\/problems\/([^/]+)(?:\/|$)/;

/** NeetCode expose le verdict sous forme de libellé, sans code numérique. */
export const STATUS_ACCEPTED = "Accepted";

export type SubmitKind = "code" | "sql";

export interface Verdict {
  statusDescription: string;
  testCaseCount: number | null;
  correctTestCaseCount: number | null;
}

export function problemSlugFromPathname(pathname: string): string | null {
  return PROBLEM_PATH_RE.exec(pathname)?.[1] ?? null;
}

/** URL d'ouverture d'un problème depuis la file de révision. */
export function reviewProblemUrl(slug: string): string {
  return `${NC_ORIGIN}/problems/${encodeURIComponent(slug)}/question`;
}

/**
 * Contexte de liste exposé par NeetCode, par exemple ?list=neetcode150.
 * Conservé sur la carte à titre informatif.
 */
export function listSlugFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("list")?.trim().toLowerCase();
  if (!value) return null;
  return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(value) ? value : null;
}

/** Index de la soumission affichée après la navigation vers l'historique. */
export function submissionIndexFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("submissionIndex")?.trim();
  return value && /^\d+$/.test(value) ? value : null;
}

export function parseDifficulty(value: unknown): Difficulty {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
}

/**
 * Normalise les URLs absolues et relatives avant matching : les deux formes
 * circulent selon le transport utilisé par Angular.
 */
function pathnameFor(url: string): string | null {
  try {
    return new URL(url, NC_ORIGIN).pathname;
  } catch {
    return null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Lit uniquement le drapeau `runOnly` d'un appel SQL. Le corps parsé n'est ni
 * conservé ni journalisé : seul un booléen en sort, jamais le code.
 */
function sqlIsSubmit(body: string | null): boolean {
  if (body === null || body.length > MAX_BODY_BYTES) return false;
  const parsed = safeJson(body);
  if (!isRecord(parsed) || !isRecord(parsed.data)) return false;
  return parsed.data.runOnly === false;
}

/**
 * `null` si la requête n'est pas une soumission. Le slug du problème n'est
 * jamais lu ici : il vient de l'URL de la page, donc `rawCode` reste intouché.
 */
export function submitKindForRequest(
  method: string,
  url: string,
  body: string | null,
): SubmitKind | null {
  if (method.toUpperCase() !== "POST") return null;
  switch (pathnameFor(url)) {
    case SUBMIT_PATH:
      return "code";
    case SQL_PATH:
      return sqlIsSubmit(body) ? "sql" : null;
    default:
      return null; // RUN_PATH compris
  }
}

export function isMetadataRequest(url: string): boolean {
  return pathnameFor(url) === METADATA_PATH;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Le verdict vit dans `{ data: { status: { description } } }`. */
export function verdictFromResponse(text: string): Verdict | null {
  const json = safeJson(text);
  if (!isRecord(json) || !isRecord(json.data)) return null;
  const { data } = json;
  if (!isRecord(data.status) || typeof data.status.description !== "string") return null;
  return {
    statusDescription: data.status.description,
    testCaseCount: numberOrNull(data.test_case_count),
    correctTestCaseCount: numberOrNull(data.correct_test_case_count),
  };
}

export function isAcceptedVerdict(statusDescription: unknown): boolean {
  return (
    typeof statusDescription === "string" &&
    statusDescription.trim().toLowerCase() === STATUS_ACCEPTED.toLowerCase()
  );
}
