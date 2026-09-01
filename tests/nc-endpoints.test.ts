import assert from "node:assert/strict";
import {
  isAcceptedVerdict,
  isMetadataRequest,
  listSlugFromSearch,
  parseDifficulty,
  problemSlugFromPathname,
  reviewProblemUrl,
  submissionIndexFromSearch,
  submitKindForRequest,
  verdictFromResponse,
} from "../src/nc-endpoints";

function response(description: string, correct = 20, total = 20): string {
  return JSON.stringify({
    data: {
      status: { id: 3, description },
      test_case_count: total,
      correct_test_case_count: correct,
      stdout: "",
      memory: 17_432,
      date: "2026-08-09T18:00:00.000Z",
    },
  });
}

const codeBody = JSON.stringify({
  data: { problemId: "duplicate-integer", rawCode: "class Solution: pass", lang: "python" },
});

assert.equal(
  submitKindForRequest("POST", "/api/executeCodeFunctionHttp", codeBody),
  "code",
);
assert.equal(
  submitKindForRequest(
    "POST",
    "https://neetcode.io/api/executeCodeFunctionHttp?x=1",
    null,
  ),
  "code",
);
assert.equal(submitKindForRequest("POST", "/api/runCodeFunctionHttp", codeBody), null);
assert.equal(
  submitKindForRequest("POST", "/api/getProblemMetadataFunctionHttp", null),
  null,
);
assert.equal(submitKindForRequest("GET", "/api/executeCodeFunctionHttp", null), null);
assert.equal(submitKindForRequest("POST", "pas une url", null), null);

const sqlBody = (runOnly: boolean): string =>
  JSON.stringify({ data: { problemId: "x", rawCode: "SELECT 1;", runOnly } });
assert.equal(submitKindForRequest("POST", "/api/runSqlFunctionHttp", sqlBody(false)), "sql");
assert.equal(submitKindForRequest("POST", "/api/runSqlFunctionHttp", sqlBody(true)), null);
assert.equal(submitKindForRequest("POST", "/api/runSqlFunctionHttp", null), null);
assert.equal(submitKindForRequest("POST", "/api/runSqlFunctionHttp", "{pas du json"), null);
assert.equal(
  submitKindForRequest(
    "POST",
    "/api/runSqlFunctionHttp",
    JSON.stringify({ data: { rawCode: '-- "runOnly":false', runOnly: true } }),
  ),
  null,
);

assert.deepEqual(verdictFromResponse(response("Accepted")), {
  statusDescription: "Accepted",
  testCaseCount: 20,
  correctTestCaseCount: 20,
});
assert.equal(verdictFromResponse(response("Wrong Answer", 7, 20))?.statusDescription, "Wrong Answer");
assert.equal(verdictFromResponse(response("Wrong Answer", 7, 20))?.correctTestCaseCount, 7);
assert.equal(verdictFromResponse(""), null);
assert.equal(verdictFromResponse("{}"), null);
assert.equal(verdictFromResponse(JSON.stringify({ data: {} })), null);
assert.equal(verdictFromResponse(JSON.stringify({ data: { status: {} } })), null);
assert.deepEqual(
  verdictFromResponse(JSON.stringify({ data: { status: { description: "Accepted" } } })),
  {
    statusDescription: "Accepted",
    testCaseCount: null,
    correctTestCaseCount: null,
  },
);

assert.equal(isAcceptedVerdict("Accepted"), true);
assert.equal(isAcceptedVerdict("  accepted "), true);
for (const value of ["Wrong Answer", "Time Limit Exceeded", "", null, undefined, 10]) {
  assert.equal(isAcceptedVerdict(value), false);
}

assert.equal(problemSlugFromPathname("/problems/duplicate-integer"), "duplicate-integer");
assert.equal(problemSlugFromPathname("/problems/duplicate-integer/question"), "duplicate-integer");
assert.equal(
  problemSlugFromPathname("/problems/duplicate-integer/submissions"),
  "duplicate-integer",
);
assert.equal(problemSlugFromPathname("/practice"), null);
assert.equal(problemSlugFromPathname("/"), null);
assert.equal(
  reviewProblemUrl("duplicate-integer"),
  "https://neetcode.io/problems/duplicate-integer/question",
);

assert.equal(listSlugFromSearch("?list=neetcode150"), "neetcode150");
assert.equal(listSlugFromSearch("?tab=x&list=NeetCode250"), "neetcode250");
assert.equal(listSlugFromSearch(""), null);
assert.equal(listSlugFromSearch("?list="), null);
assert.equal(listSlugFromSearch("?list=../etc"), null);

assert.equal(submissionIndexFromSearch("?list=neetcode150&submissionIndex=3"), "3");
assert.equal(submissionIndexFromSearch("?submissionIndex=-1"), null);
assert.equal(submissionIndexFromSearch("?submissionIndex=abc"), null);
assert.equal(submissionIndexFromSearch(""), null);

assert.equal(parseDifficulty("Easy"), "Easy");
assert.equal(parseDifficulty("Medium"), "Medium");
assert.equal(parseDifficulty("Hard"), "Hard");
assert.equal(parseDifficulty("easy"), "Unknown");
assert.equal(parseDifficulty(undefined), "Unknown");

assert.equal(isMetadataRequest("/api/getProblemMetadataFunctionHttp"), true);
assert.equal(isMetadataRequest("https://neetcode.io/api/getProblemMetadataFunctionHttp"), true);
assert.equal(isMetadataRequest("/api/runCodeFunctionHttp"), false);

console.log("nc-endpoints: ok");
