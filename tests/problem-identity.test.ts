import { describe, expect, it } from "vitest";
import {
  findExistingProblemId,
  normalizeProblemTitle,
  preferredProblemId,
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

describe("identité canonique", () => {
  it("utilise l'alias LeetCode malgré un slug NeetCode différent", () => {
    expect(preferredProblemId(nc("duplicate-integer", "Contains Duplicate"))).toBe(
      "leetcode:contains-duplicate",
    );
    expect(preferredProblemId(nc("linked-list-cycle-detection", "Linked List Cycle Detection"))).toBe(
      "leetcode:linked-list-cycle",
    );
    expect(preferredProblemId(nc("two-integer-sum-ii", "Two Integer Sum II"))).toBe(
      "leetcode:two-sum-ii-input-array-is-sorted",
    );
  });

  it("normalise casse, ponctuation et accents", () => {
    expect(normalizeProblemTitle("  Pow(x, n) — Été ")).toBe("pow x n ete");
  });

  it("tolère une petite variation sans confondre des problèmes voisins", () => {
    expect(titlesProbablyMatch("Linked List Cycle", "Linked List Cycle Detection")).toBe(true);
    expect(titlesProbablyMatch("Meeting Rooms", "Meeting Rooms II")).toBe(false);
    expect(
      titlesProbablyMatch("Search in Rotated Sorted Array", "Search in Rotated Sorted Array II"),
    ).toBe(false);
    expect(titlesProbablyMatch("Two Sum", "Three Sum")).toBe(false);
  });

  it("retrouve une carte existante par source puis par titre", () => {
    const card = {
      id: "leetcode:contains-duplicate",
      title: "Contains Duplicate",
      sources: {
        leetcode: {
          slug: "contains-duplicate",
          frontendId: "217",
          listSlug: null,
          difficulty: "Easy",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
        },
      },
    } as ProblemCard;
    const cards = { [card.id]: card };
    expect(findExistingProblemId(cards, nc("unknown-slug", "Contains Duplicate"))).toBe(card.id);
  });
});
