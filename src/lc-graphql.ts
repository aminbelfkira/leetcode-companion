// Métadonnées du problème via GraphQL LeetCode (§5.2) + fallback document.title.
// À appeler depuis le content ISOLATED (même origine, cookies inclus).

import { GRAPHQL_URL } from "./lc-endpoints";
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

function csrfToken(): string | null {
  const m = /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie);
  return m?.[1] ?? null;
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
