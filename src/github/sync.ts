import { githubApiJson, GithubApiError } from "./api";
import type { AcceptedSubmissionForSync, GithubRepository } from "./types";

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  dart: "dart",
  elixir: "ex",
  erlang: "erl",
  golang: "go",
  java: "java",
  javascript: "js",
  kotlin: "kt",
  mysql: "sql",
  oraclesql: "sql",
  mssql: "sql",
  php: "php",
  python: "py",
  python3: "py",
  pythonml: "py",
  pandas: "py",
  racket: "rkt",
  ruby: "rb",
  rust: "rs",
  scala: "scala",
  swift: "swift",
  typescript: "ts",
};

function safePathSegment(value: string): string {
  const safe = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return safe.length > 0 ? safe : "problem";
}

function problemFolder(frontendId: string, slug: string): string {
  const id = /^\d+$/.test(frontendId) ? frontendId.padStart(4, "0") : safePathSegment(frontendId);
  return `${id}-${safePathSegment(slug)}`;
}

function extensionFor(language: string): string {
  return LANGUAGE_EXTENSIONS[language.toLowerCase()] ?? safePathSegment(language);
}

function commentPrefix(extension: string): string {
  if (["py", "rb", "sh", "r"].includes(extension)) return "#";
  if (extension === "sql") return "--";
  if (extension === "rkt") return ";;";
  if (extension === "erl") return "%";
  return "//";
}

function roundedPercentile(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100) / 100}%`;
}

function metricLine(label: string, display: string | null, percentile: number | null): string | null {
  if (display === null && percentile === null) return null;
  const beats = roundedPercentile(percentile);
  return `${label}: ${display ?? "—"}${beats === null ? "" : ` · Beats ${beats}`}`;
}

export function githubSolutionPath(submission: AcceptedSubmissionForSync): string {
  const extension = extensionFor(submission.language);
  return `solutions/${problemFolder(submission.frontendId, submission.slug)}/solution.${extension}`;
}

export function githubSolutionContent(submission: AcceptedSubmissionForSync): string {
  const extension = extensionFor(submission.language);
  const prefix = commentPrefix(extension);
  const runtime = metricLine(
    "Runtime",
    submission.runtimeDisplay,
    submission.runtimePercentile,
  );
  const memory = metricLine("Memory", submission.memoryDisplay, submission.memoryPercentile);
  const header = [
    `${submission.frontendId}. ${submission.title}`,
    `https://leetcode.com/problems/${submission.slug}/`,
    `Accepted: ${submission.acceptedAt}`,
    `Language: ${submission.languageDisplay}`,
    runtime,
    memory,
    `Submission: https://leetcode.com/submissions/detail/${submission.submissionId}/`,
  ].filter((line): line is string => line !== null);
  const code = submission.code.endsWith("\n") ? submission.code : `${submission.code}\n`;
  return `${header.map((line) => `${prefix} ${line}`).join("\n")}\n\n${code}`;
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

interface ExistingFileResponse {
  sha?: unknown;
}

export async function syncSubmissionToGithub(
  token: string,
  repository: GithubRepository,
  submission: AcceptedSubmissionForSync,
): Promise<string> {
  const path = githubSolutionPath(submission);
  const apiPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/contents/${encodedPath(path)}`;
  let sha: string | undefined;
  try {
    const existing = await githubApiJson<ExistingFileResponse>(
      `${apiPath}?ref=${encodeURIComponent(repository.defaultBranch)}`,
      token,
    );
    if (typeof existing.sha === "string") sha = existing.sha;
  } catch (error) {
    if (!(error instanceof GithubApiError) || error.status !== 404) throw error;
  }

  await githubApiJson<unknown>(apiPath, token, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: `solve: ${submission.frontendId}. ${submission.title}`,
      content: base64Utf8(githubSolutionContent(submission)),
      branch: repository.defaultBranch,
      ...(sha === undefined ? {} : { sha }),
    }),
  });
  return path;
}
