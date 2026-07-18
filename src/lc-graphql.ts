// Métadonnées du problème via GraphQL LeetCode (§5.2) + fallback document.title.
// À appeler depuis le content ISOLATED (même origine, cookies inclus).

import { GRAPHQL_URL } from "./lc-endpoints";
import type { AcceptedSubmissionForSync } from "./github/types";
import type { ProblemCard } from "./types";

export interface QuestionMeta {
  frontendId: string;
  title: string;
  lcDifficulty: ProblemCard["lcDifficulty"];
  metaIncomplete: boolean;
}

const QUERY = `query questionMeta($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    difficulty
  }
}`;

const SUBMISSION_DETAILS_QUERY = `query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    runtime
    runtimeDisplay
    runtimePercentile
    memory
    memoryDisplay
    memoryPercentile
    code
    timestamp
    statusCode
    lang {
      name
      verboseName
    }
    question {
      questionId
      questionFrontendId
      title
      titleSlug
    }
  }
}`;

interface GraphqlResponse {
  data?: {
    question?: {
      questionId?: unknown;
      questionFrontendId?: unknown;
      title?: unknown;
      difficulty?: unknown;
    } | null;
  };
}

interface SubmissionDetailsResponse {
  data?: {
    submissionDetails?: {
      runtime?: unknown;
      runtimeDisplay?: unknown;
      runtimePercentile?: unknown;
      memory?: unknown;
      memoryDisplay?: unknown;
      memoryPercentile?: unknown;
      code?: unknown;
      timestamp?: unknown;
      statusCode?: unknown;
      lang?: { name?: unknown; verboseName?: unknown } | null;
      question?: {
        questionId?: unknown;
        questionFrontendId?: unknown;
        title?: unknown;
        titleSlug?: unknown;
      } | null;
    } | null;
  };
}

function csrfToken(): string | null {
  const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie);
  return m?.[1] ?? null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function acceptedTimestamp(value: unknown): string {
  const numeric = optionalNumber(value);
  if (numeric !== null) {
    const millis = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function displayMetric(display: unknown, raw: unknown, suffix: string): string | null {
  const formatted = optionalString(display);
  if (formatted !== null) return formatted;
  const value = optionalString(raw) ?? (typeof raw === "number" ? String(raw) : null);
  return value === null ? null : `${value} ${suffix}`;
}

function parseDifficulty(value: unknown): ProblemCard["lcDifficulty"] {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
}

export async function fetchQuestionMeta(slug: string): Promise<QuestionMeta | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = csrfToken();
  if (csrf !== null) headers["x-csrftoken"] = csrf;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      operationName: "questionMeta",
      query: QUERY,
      variables: { titleSlug: slug },
    }),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as GraphqlResponse;
  const q = json.data?.question;
  if (!q || typeof q.questionFrontendId !== "string" || typeof q.title !== "string") {
    return null;
  }
  return {
    frontendId: q.questionFrontendId,
    title: q.title,
    lcDifficulty: parseDifficulty(q.difficulty),
    metaIncomplete: false,
  };
}

/**
 * Lit le code uniquement après un Accepted et uniquement à l'appel explicite
 * du content script lorsque GitHub Sync est actif.
 */
export async function fetchAcceptedSubmissionForSync(
  submissionId: string,
  expectedSlug: string,
  collectionSlug: string | null,
): Promise<AcceptedSubmissionForSync | null> {
  if (!/^\d+$/.test(submissionId)) return null;
  const numericId = Number(submissionId);
  if (!Number.isSafeInteger(numericId) || numericId < 0) return null;

  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = csrfToken();
  if (csrf !== null) headers["x-csrftoken"] = csrf;
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      operationName: "submissionDetails",
      query: SUBMISSION_DETAILS_QUERY,
      variables: { submissionId: numericId },
    }),
  });
  if (!response.ok) return null;

  const json = (await response.json()) as SubmissionDetailsResponse;
  return parseAcceptedSubmissionForSyncResponse(
    json,
    submissionId,
    expectedSlug,
    collectionSlug,
  );
}

export function parseAcceptedSubmissionForSyncResponse(
  json: SubmissionDetailsResponse,
  submissionId: string,
  expectedSlug: string,
  collectionSlug: string | null = null,
): AcceptedSubmissionForSync | null {
  const details = json.data?.submissionDetails;
  const question = details?.question;
  const lang = details?.lang;
  const statusCode = optionalNumber(details?.statusCode);
  const slug = optionalString(question?.titleSlug);
  const title = optionalString(question?.title);
  const frontendId =
    optionalString(question?.questionFrontendId) ?? optionalString(question?.questionId);
  const language = optionalString(lang?.name);
  const languageDisplay = optionalString(lang?.verboseName) ?? language;
  if (
    statusCode !== 10 ||
    slug !== expectedSlug ||
    title === null ||
    frontendId === null ||
    language === null ||
    languageDisplay === null ||
    typeof details?.code !== "string"
  ) {
    return null;
  }

  return {
    submissionId,
    slug,
    collectionSlug,
    frontendId,
    title,
    language,
    languageDisplay,
    code: details.code,
    runtimeDisplay: displayMetric(details.runtimeDisplay, details.runtime, "ms"),
    runtimePercentile: optionalNumber(details.runtimePercentile),
    memoryDisplay: displayMetric(details.memoryDisplay, details.memory, "MB"),
    memoryPercentile: optionalNumber(details.memoryPercentile),
    acceptedAt: acceptedTimestamp(details.timestamp),
  };
}

/** Fallback §5.2 : document.title au format « 1. Two Sum - LeetCode ». */
export function metaFromDocumentTitle(docTitle: string): QuestionMeta | null {
  const m = /^(\d+)\.\s*(.+?)\s*-\s*LeetCode/.exec(docTitle);
  const frontendId = m?.[1];
  const title = m?.[2];
  if (frontendId === undefined || title === undefined) return null;
  return { frontendId, title, lcDifficulty: "Unknown", metaIncomplete: true };
}

/** GraphQL, sinon titre du document, sinon slug brut — ne rejette jamais. */
export async function resolveMeta(slug: string): Promise<QuestionMeta> {
  try {
    const meta = await fetchQuestionMeta(slug);
    if (meta !== null) return meta;
  } catch {
    // silencieux : fallback ci-dessous
  }
  return (
    metaFromDocumentTitle(document.title) ?? {
      frontendId: "?",
      title: slug,
      lcDifficulty: "Unknown",
      metaIncomplete: true,
    }
  );
}
