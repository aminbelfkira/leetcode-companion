// Métadonnées du problème (titre, difficulté) via l'API NeetCode, avec repli
// sur le DOM. À appeler depuis le content script : même origine que neetcode.io.

import { METADATA_PATH, parseDifficulty } from "./nc-endpoints";
import type { Difficulty } from "./types";

export interface ProblemMeta {
  title: string;
  ncDifficulty: Difficulty;
  metaIncomplete: boolean;
}

const cache = new Map<string, ProblemMeta>();

interface MetadataResponse {
  data?: {
    id?: unknown;
    name?: unknown;
    difficulty?: unknown;
  } | null;
}

/**
 * `{"data":{"problemId":"duplicate-integer"}}` renvoie `{ id, name, difficulty, … }`.
 * L'endpoint répond sans authentification ; seuls deux champs sont lus.
 */
async function fetchProblemMeta(slug: string): Promise<ProblemMeta | null> {
  const response = await fetch(METADATA_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data: { problemId: slug } }),
  });
  if (!response.ok) return null;

  const json = (await response.json()) as MetadataResponse;
  const name = json.data?.name;
  if (typeof name !== "string" || name.trim() === "") return null;
  return {
    title: name.trim(),
    ncDifficulty: parseDifficulty(json.data?.difficulty),
    metaIncomplete: false,
  };
}

/** Repli : titre h1 ou document.title, difficulté lue sur la pastille. */
function metaFromDocument(slug: string): ProblemMeta {
  const heading = document.querySelector("h1")?.textContent?.trim();
  const documentTitle = /^(.+?)\s*-\s*NeetCode\s*$/.exec(document.title)?.[1]?.trim();
  const pill = document.querySelector(".difficulty-pill")?.textContent?.trim() ?? "";
  const normalized = pill.charAt(0).toUpperCase() + pill.slice(1).toLowerCase();

  return {
    title: heading || documentTitle || slug,
    ncDifficulty: parseDifficulty(normalized),
    metaIncomplete: true,
  };
}

/** API d'abord, sinon DOM, sinon slug brut. Ne rejette jamais. */
export async function resolveMeta(slug: string): Promise<ProblemMeta> {
  const cached = cache.get(slug);
  if (cached !== undefined) return cached;
  try {
    const meta = await fetchProblemMeta(slug);
    if (meta !== null) {
      cache.set(slug, meta);
      return meta;
    }
  } catch {
    // silencieux : repli ci-dessous
  }
  return metaFromDocument(slug);
}
