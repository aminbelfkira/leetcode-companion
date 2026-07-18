import assert from "node:assert/strict";
import {
  GITHUB_APP_SLUG,
  GITHUB_CLIENT_ID,
  GITHUB_INSTALLATION_URL,
} from "../src/github/config";
import {
  githubSolutionContent,
  githubSolutionPath,
  syncSubmissionToGithub,
} from "../src/github/sync";
import type { AcceptedSubmissionForSync, GithubRepository } from "../src/github/types";
import { collectionSlugFromSearch } from "../src/lc-endpoints";
import { parseAcceptedSubmissionForSyncResponse } from "../src/lc-graphql";

assert.equal(GITHUB_CLIENT_ID, "Iv23li2ck926gmzxSkow");
assert.equal(GITHUB_APP_SLUG, "leetcode-companion-aminbelfkira");
assert.equal(
  GITHUB_INSTALLATION_URL,
  "https://github.com/apps/leetcode-companion-aminbelfkira/installations/new",
);

const cpp: AcceptedSubmissionForSync = {
  submissionId: "2071621585",
  slug: "remove-element",
  collectionSlug: null,
  frontendId: "27",
  title: "Remove Element",
  language: "cpp",
  languageDisplay: "C++",
  code: "class Solution { /* é */ };",
  runtimeDisplay: "0 ms",
  runtimePercentile: 100,
  memoryDisplay: "18.2 MB",
  memoryPercentile: 82.345,
  acceptedAt: "2026-07-19T12:00:00.000Z",
};

assert.equal(
  githubSolutionPath(cpp),
  "solutions/0027-remove-element/solution.cpp",
);
const cppContent = githubSolutionContent(cpp);
assert.match(cppContent, /^\/\/ 27\. Remove Element/m);
assert.match(cppContent, /^\/\/ Runtime: 0 ms · Beats 100%$/m);
assert.match(cppContent, /^\/\/ Memory: 18\.2 MB · Beats 82\.35%$/m);
assert.ok(cppContent.endsWith("class Solution { /* é */ };\n"));

const topInterview = { ...cpp, collectionSlug: "top-interview-150" };
assert.equal(
  githubSolutionPath(topInterview),
  "top-interview-150/0027-remove-element/solution.cpp",
);
assert.match(githubSolutionContent(topInterview), /^\/\/ Collection: top-interview-150$/m);

const legacySubmission = { ...cpp } as Partial<AcceptedSubmissionForSync>;
delete legacySubmission.collectionSlug;
assert.equal(
  githubSolutionPath(legacySubmission as AcceptedSubmissionForSync),
  "solutions/0027-remove-element/solution.cpp",
);

assert.equal(
  collectionSlugFromSearch("?envType=study-plan-v2&envId=top-interview-150"),
  "top-interview-150",
);
assert.equal(collectionSlugFromSearch("?envType=study-plan-v2"), null);
assert.equal(
  collectionSlugFromSearch("?envType=study-plan-v2&envId=..%2Fprivate"),
  null,
);

const python: AcceptedSubmissionForSync = {
  ...cpp,
  language: "python3",
  languageDisplay: "Python3",
  code: "class Solution:\n    pass\n",
  runtimeDisplay: null,
  runtimePercentile: null,
  memoryDisplay: null,
  memoryPercentile: null,
};
assert.equal(
  githubSolutionPath(python),
  "solutions/0027-remove-element/solution.py",
);
const pythonContent = githubSolutionContent(python);
assert.match(pythonContent, /^# 27\. Remove Element/m);
assert.doesNotMatch(pythonContent, /Runtime:/);
assert.doesNotMatch(pythonContent, /Memory:/);

const parsed = parseAcceptedSubmissionForSyncResponse(
  {
    data: {
      submissionDetails: {
        statusCode: "10",
        code: "const answer = 42;",
        runtimeDisplay: "1 ms",
        runtimePercentile: "99.5",
        memoryDisplay: "44.2 MB",
        memoryPercentile: 75,
        timestamp: "1784462400",
        lang: { name: "javascript", verboseName: "JavaScript" },
        question: {
          questionId: "27",
          questionFrontendId: "27",
          title: "Remove Element",
          titleSlug: "remove-element",
        },
      },
    },
  },
  "2071621585",
  "remove-element",
  "top-interview-150",
);
assert.equal(parsed?.code, "const answer = 42;");
assert.equal(parsed?.collectionSlug, "top-interview-150");
assert.equal(parsed?.runtimePercentile, 99.5);
assert.equal(parsed?.acceptedAt, "2026-07-19T12:00:00.000Z");
assert.equal(
  parseAcceptedSubmissionForSyncResponse(
    { data: { submissionDetails: { ...parsed, statusCode: 10 } } },
    "2071621585",
    "another-problem",
  ),
  null,
);

const repository: GithubRepository = {
  id: 1,
  installationId: 2,
  owner: "aminbelfkira",
  name: "leetcode-solutions",
  fullName: "aminbelfkira/leetcode-solutions",
  defaultBranch: "main",
  private: true,
};

const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; init: RequestInit }> = [];
try {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if ((init.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ content: { sha: "new" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  const syncedPath = await syncSubmissionToGithub("token-test", repository, cpp);
  assert.equal(syncedPath, githubSolutionPath(cpp));
  assert.equal(requests.length, 2);
  assert.match(requests[0]?.url ?? "", /\/contents\/solutions\/0027-remove-element\/solution\.cpp\?ref=main$/);
  const put = requests[1];
  assert.equal(put?.init.method, "PUT");
  const headers = put?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer token-test");
  const body = JSON.parse(String(put?.init.body)) as { content: string; sha?: string };
  assert.equal(body.sha, undefined);
  assert.equal(Buffer.from(body.content, "base64").toString("utf8"), cppContent);

  requests.length = 0;
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    if ((init.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ sha: "existing-sha" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ content: { sha: "updated" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await syncSubmissionToGithub("token-test", repository, cpp);
  const updateBody = JSON.parse(String(requests[1]?.init.body)) as { sha?: string };
  assert.equal(updateBody.sha, "existing-sha");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("github-sync: ok");
