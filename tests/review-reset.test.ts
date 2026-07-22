import assert from "node:assert/strict";
import {
  isReviewLaunchSearch,
  reviewProblemUrl,
  withoutReviewLaunchMarker,
} from "../src/lc-endpoints";

assert.equal(
  reviewProblemUrl("two-sum"),
  "https://leetcode.com/problems/two-sum/?lcCompanionReview=1",
);
assert.equal(isReviewLaunchSearch("?lcCompanionReview=1"), true);
assert.equal(isReviewLaunchSearch("?lcCompanionReview=0"), false);
assert.equal(
  isReviewLaunchSearch(
    "?envType=study-plan-v2&lcCompanionReview=1&envId=top-interview-150",
  ),
  true,
);
assert.equal(
  withoutReviewLaunchMarker(
    "https://leetcode.com/problems/two-sum/?envType=study-plan-v2&lcCompanionReview=1&envId=top-interview-150#editor",
  ),
  "/problems/two-sum/?envType=study-plan-v2&envId=top-interview-150#editor",
);

console.log("review-reset: ok");
