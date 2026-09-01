import type { ProblemCard, ProblemDescriptor, ProblemSource } from "./types";

/**
 * NeetCode change parfois complètement le slug d'un problème LeetCode.
 * Cette table couvre les divergences du NeetCode 250 ; les slugs identiques
 * n'ont pas besoin d'y figurer. Les titres normalisés couvrent le reste.
 */
export const NEETCODE_TO_LEETCODE_SLUG: Readonly<Record<string, string>> = {
  "duplicate-integer": "contains-duplicate",
  "is-anagram": "valid-anagram",
  "two-integer-sum": "two-sum",
  "anagram-groups": "group-anagrams",
  "top-k-elements-in-list": "top-k-frequent-elements",
  "string-encode-and-decode": "encode-and-decode-strings",
  "products-of-array-discluding-self": "product-of-array-except-self",
  "is-palindrome": "valid-palindrome",
  "two-integer-sum-ii": "two-sum-ii-input-array-is-sorted",
  "three-integer-sum": "3sum",
  "max-water-container": "container-with-most-water",
  "buy-and-sell-crypto": "best-time-to-buy-and-sell-stock",
  "longest-substring-without-duplicates": "longest-substring-without-repeating-characters",
  "longest-repeating-substring-with-replacement": "longest-repeating-character-replacement",
  "permutation-string": "permutation-in-string",
  "minimum-window-with-characters": "minimum-window-substring",
  "validate-parentheses": "valid-parentheses",
  "minimum-stack": "min-stack",
  "search-2d-matrix": "search-a-2d-matrix",
  "eating-bananas": "koko-eating-bananas",
  "find-target-in-rotated-sorted-array": "search-in-rotated-sorted-array",
  "reverse-a-linked-list": "reverse-linked-list",
  "merge-two-sorted-linked-lists": "merge-two-sorted-lists",
  "linked-list-cycle-detection": "linked-list-cycle",
  "reorder-linked-list": "reorder-list",
  "remove-node-from-end-of-linked-list": "remove-nth-node-from-end-of-list",
  "copy-linked-list-with-random-pointer": "copy-list-with-random-pointer",
  "find-duplicate-integer": "find-the-duplicate-number",
  "merge-k-sorted-linked-lists": "merge-k-sorted-lists",
  "invert-a-binary-tree": "invert-binary-tree",
  "depth-of-binary-tree": "maximum-depth-of-binary-tree",
  "binary-tree-diameter": "diameter-of-binary-tree",
  "same-binary-tree": "same-tree",
  "subtree-of-a-binary-tree": "subtree-of-another-tree",
  "lowest-common-ancestor-in-binary-search-tree":
    "lowest-common-ancestor-of-a-binary-search-tree",
  "level-order-traversal-of-binary-tree": "binary-tree-level-order-traversal",
  "valid-binary-search-tree": "validate-binary-search-tree",
  "kth-smallest-integer-in-bst": "kth-smallest-element-in-a-bst",
  "binary-tree-from-preorder-and-inorder-traversal":
    "construct-binary-tree-from-preorder-and-inorder-traversal",
  "kth-largest-integer-in-a-stream": "kth-largest-element-in-a-stream",
  "task-scheduling": "task-scheduler",
  "design-twitter-feed": "design-twitter",
  "find-median-in-a-data-stream": "find-median-from-data-stream",
  "combination-target-sum": "combination-sum",
  "combination-target-sum-ii": "combination-sum-ii",
  "search-for-word": "word-search",
  "combinations-of-a-phone-number": "letter-combinations-of-a-phone-number",
  "implement-prefix-tree": "implement-trie-prefix-tree",
  "design-word-search-data-structure": "design-add-and-search-words-data-structure",
  "search-for-word-ii": "word-search-ii",
  "count-number-of-islands": "number-of-islands",
  "islands-and-treasure": "walls-and-gates",
  "rotting-fruit": "rotting-oranges",
  "valid-tree": "graph-valid-tree",
  "count-connected-components": "number-of-connected-components-in-an-undirected-graph",
  "reconstruct-flight-path": "reconstruct-itinerary",
  "min-cost-to-connect-points": "min-cost-to-connect-all-points",
  "foreign-dictionary": "alien-dictionary",
  "cheapest-flight-path": "cheapest-flights-within-k-stops",
  "count-paths": "unique-paths",
  "buy-and-sell-crypto-with-cooldown": "best-time-to-buy-and-sell-stock-with-cooldown",
  "longest-increasing-path-in-matrix": "longest-increasing-path-in-a-matrix",
  "count-subsequences": "distinct-subsequences",
  "merge-triplets-to-form-target": "merge-triplets-to-form-target-triplet",
  "insert-new-interval": "insert-interval",
  "meeting-schedule": "meeting-rooms",
  "meeting-schedule-ii": "meeting-rooms-ii",
  "minimum-interval-including-query": "minimum-interval-to-include-each-query",
  "rotate-matrix": "rotate-image",
  "set-zeroes-in-matrix": "set-matrix-zeroes",
  "non-cyclical-number": "happy-number",
  "pow-x-n": "powx-n",
  "count-squares": "detect-squares",
  "number-of-one-bits": "number-of-1-bits",
};

export function normalizeProblemTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function preferredProblemId(problem: ProblemDescriptor): string {
  const leetcodeSlug =
    problem.platform === "leetcode"
      ? problem.slug
      : NEETCODE_TO_LEETCODE_SLUG[problem.slug];
  return leetcodeSlug === undefined
    ? `title:${normalizeProblemTitle(problem.title) || problem.slug}`
    : `leetcode:${leetcodeSlug}`;
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? right.length;
}

/** Rapproche uniquement les variantes très proches, pour éviter les faux doublons. */
export function titlesProbablyMatch(left: string, right: string): boolean {
  const a = normalizeProblemTitle(left);
  const b = normalizeProblemTitle(right);
  if (a === b) return a.length > 0;
  const longest = Math.max(a.length, b.length);
  if (longest < 8) return false;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const versionToken = /^(?:\d+|[ivxlcdm]+)$/;
  const differingTokens = [...aTokens, ...bTokens].filter(
    (token) => aTokens.has(token) !== bTokens.has(token),
  );
  if (differingTokens.some((token) => versionToken.test(token))) return false;
  if (1 - levenshtein(a, b) / longest >= 0.9) return true;

  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  const smaller = Math.min(aTokens.size, bTokens.size);
  const larger = Math.max(aTokens.size, bTokens.size);
  if (shared < 2 || shared !== smaller || larger - smaller !== 1) return false;
  const smallerTokens = aTokens.size <= bTokens.size ? aTokens : bTokens;
  const largerTokens = aTokens.size > bTokens.size ? aTokens : bTokens;
  const extra = [...largerTokens].find((token) => !smallerTokens.has(token));
  return extra === "detection";
}

export function findExistingProblemId(
  cards: Record<string, ProblemCard>,
  problem: ProblemDescriptor,
): string | null {
  const preferred = preferredProblemId(problem);
  if (cards[preferred] !== undefined) return preferred;

  for (const card of Object.values(cards)) {
    const source = card.sources[problem.platform];
    if (source?.slug === problem.slug) return card.id;
    if (
      problem.frontendId !== null &&
      Object.values(card.sources).some(
        (candidate) => candidate?.frontendId === problem.frontendId,
      )
    ) {
      return card.id;
    }
  }

  const exactTitle = Object.values(cards).filter(
    (card) => normalizeProblemTitle(card.title) === normalizeProblemTitle(problem.title),
  );
  if (exactTitle.length === 1) return exactTitle[0]?.id ?? null;

  const fuzzyTitle = Object.values(cards).filter((card) =>
    titlesProbablyMatch(card.title, problem.title),
  );
  return fuzzyTitle.length === 1 ? (fuzzyTitle[0]?.id ?? null) : null;
}

export function sourceFromDescriptor(
  problem: ProblemDescriptor,
  now: string = new Date().toISOString(),
  previous?: ProblemSource,
): ProblemSource {
  return {
    slug: problem.slug,
    frontendId: problem.frontendId ?? previous?.frontendId ?? null,
    listSlug: problem.listSlug ?? previous?.listSlug ?? null,
    difficulty:
      problem.difficulty === "Unknown"
        ? (previous?.difficulty ?? "Unknown")
        : problem.difficulty,
    lastSeenAt: now,
  };
}

export function problemUrl(
  card: ProblemCard,
  preferredPlatform?: "leetcode" | "neetcode",
): string {
  const platform =
    preferredPlatform !== undefined && card.sources[preferredPlatform] !== undefined
      ? preferredPlatform
      : card.sources.leetcode !== undefined
        ? "leetcode"
        : "neetcode";
  const source = card.sources[platform];
  if (source === undefined) return "https://neetcode.io/practice";
  return platform === "leetcode"
    ? `https://leetcode.com/problems/${encodeURIComponent(source.slug)}/?lcCompanionReview=1`
    : `https://neetcode.io/problems/${encodeURIComponent(source.slug)}/question`;
}
