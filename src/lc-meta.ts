import { GRAPHQL_URL } from "./lc-endpoints";
import type { Difficulty } from "./types";

export interface LeetCodeMeta {
  frontendId: string;
  title: string;
  difficulty: Difficulty;
  metaIncomplete: boolean;
}

const QUERY = `query questionMeta($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId
    title
    difficulty
  }
}`;

interface GraphqlResponse {
  data?: {
    question?: {
      questionFrontendId?: unknown;
      title?: unknown;
      difficulty?: unknown;
    } | null;
  };
}

function parseDifficulty(value: unknown): Difficulty {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
}

function csrfToken(): string | null {
  return /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? null;
}

export async function fetchLeetCodeMeta(slug: string): Promise<LeetCodeMeta | null> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const csrf = csrfToken();
  if (csrf !== null) headers["x-csrftoken"] = csrf;
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify({
      operationName: "questionMeta",
      query: QUERY,
      variables: { titleSlug: slug },
    }),
  });
  if (!response.ok) return null;
  const question = ((await response.json()) as GraphqlResponse).data?.question;
  if (
    question === null ||
    question === undefined ||
    typeof question.questionFrontendId !== "string" ||
    typeof question.title !== "string"
  ) {
    return null;
  }
  return {
    frontendId: question.questionFrontendId,
    title: question.title,
    difficulty: parseDifficulty(question.difficulty),
    metaIncomplete: false,
  };
}

export function leetCodeMetaFromDocumentTitle(value: string): LeetCodeMeta | null {
  const match = /^(\d+)\.\s*(.+?)\s*-\s*LeetCode/.exec(value);
  const frontendId = match?.[1];
  const title = match?.[2];
  return frontendId === undefined || title === undefined
    ? null
    : { frontendId, title, difficulty: "Unknown", metaIncomplete: true };
}

export async function resolveLeetCodeMeta(slug: string): Promise<LeetCodeMeta> {
  try {
    const meta = await fetchLeetCodeMeta(slug);
    if (meta !== null) return meta;
  } catch {
    // Le titre de la page reste un repli suffisant pour créer la carte.
  }
  return (
    leetCodeMetaFromDocumentTitle(document.title) ?? {
      frontendId: "?",
      title: slug,
      difficulty: "Unknown",
      metaIncomplete: true,
    }
  );
}
