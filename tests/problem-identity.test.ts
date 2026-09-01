import assert from "node:assert/strict";
import {
  NEETCODE_TO_LEETCODE_SLUG,
  findExistingProblemId,
  normalizeProblemTitle,
  preferredProblemId,
  problemUrl,
  sourceFromDescriptor,
  titlesProbablyMatch,
} from "../src/problem-identity";
import type { ProblemCard, ProblemDescriptor } from "../src/types";

const nc = (slug: string, title: string): ProblemDescriptor => ({
  platform: "neetcode",
  slug,
  title,
  difficulty: "Easy",
  frontendId: null,
  listSlug: null,
  metaIncomplete: false,
});

assert.equal(
  preferredProblemId(nc("duplicate-integer", "Contains Duplicate")),
  "leetcode:contains-duplicate",
);
assert.equal(
  preferredProblemId(nc("linked-list-cycle-detection", "Linked List Cycle Detection")),
  "leetcode:linked-list-cycle",
);
assert.equal(
  preferredProblemId(nc("two-integer-sum-ii", "Two Integer Sum II")),
  "leetcode:two-sum-ii-input-array-is-sorted",
);
assert.equal(
  preferredProblemId(nc("brand-new-problem", "Brand New Problem")),
  "title:brand new problem",
);
assert.equal(
  preferredProblemId({ ...nc("ignored", "Ignored"), platform: "leetcode", slug: "two-sum" }),
  "leetcode:two-sum",
);

assert.equal(Object.keys(NEETCODE_TO_LEETCODE_SLUG).length, 74);
assert.equal(NEETCODE_TO_LEETCODE_SLUG["number-of-one-bits"], "number-of-1-bits");
assert.equal(NEETCODE_TO_LEETCODE_SLUG["foreign-dictionary"], "alien-dictionary");

assert.equal(normalizeProblemTitle("  Pow(x, n) — Été "), "pow x n ete");
assert.equal(titlesProbablyMatch("Linked List Cycle", "Linked List Cycle Detection"), true);
assert.equal(titlesProbablyMatch("Meeting Rooms", "Meeting Rooms II"), false);
assert.equal(
  titlesProbablyMatch("Search in Rotated Sorted Array", "Search in Rotated Sorted Array II"),
  false,
);
assert.equal(titlesProbablyMatch("Two Sum", "Three Sum"), false);

const timestamp = "2026-01-01T00:00:00.000Z";
const card: ProblemCard = {
  id: "leetcode:contains-duplicate",
  title: "Contains Duplicate",
  difficulty: "Easy",
  sources: {
    leetcode: {
      slug: "contains-duplicate",
      frontendId: "217",
      listSlug: null,
      difficulty: "Easy",
      lastSeenAt: timestamp,
    },
    neetcode: {
      slug: "duplicate-integer",
      frontendId: null,
      listSlug: "neetcode150",
      difficulty: "Easy",
      lastSeenAt: timestamp,
    },
  },
  lastMode: "seul",
  lastFeel: 2,
  fsrs: {
    due: timestamp,
    stability: 1,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 2,
    last_review: timestamp,
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};
const cards = { [card.id]: card };

assert.equal(
  findExistingProblemId(cards, nc("unknown-slug", "Contains Duplicate")),
  card.id,
);
assert.equal(findExistingProblemId(cards, nc("duplicate-integer", "Unrelated")), card.id);
assert.equal(
  findExistingProblemId(cards, {
    ...nc("another-slug", "Unrelated"),
    frontendId: "217",
  }),
  card.id,
);

assert.deepEqual(
  sourceFromDescriptor(
    {
      ...nc("duplicate-integer", "Contains Duplicate"),
      difficulty: "Unknown",
    },
    "2026-02-01T00:00:00.000Z",
    card.sources.neetcode,
  ),
  {
    slug: "duplicate-integer",
    frontendId: null,
    listSlug: "neetcode150",
    difficulty: "Easy",
    lastSeenAt: "2026-02-01T00:00:00.000Z",
  },
);

assert.equal(
  problemUrl(card),
  "https://leetcode.com/problems/contains-duplicate/?lcCompanionReview=1",
);
assert.equal(
  problemUrl(card, "neetcode"),
  "https://neetcode.io/problems/duplicate-integer/question",
);
assert.equal(
  problemUrl({ ...card, sources: { neetcode: card.sources.neetcode } }, "leetcode"),
  "https://neetcode.io/problems/duplicate-integer/question",
);
assert.equal(
  problemUrl({ ...card, sources: {} }),
  "https://neetcode.io/practice",
);

console.log("problem-identity: ok");
