import { fakeBrowser } from "wxt/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkCooldown,
  dueCards,
  logReview,
  prepareAccepted,
  previewReview,
  saveSettingsPatch,
  snoozeBanner,
} from "../src/review";
import { getAllData, getCards, getLog, setPendingAccepted } from "../src/storage";
import type { ProblemCard, ProblemDescriptor, ReviewInput } from "../src/types";

const NC_CONTAINS_DUPLICATE: ProblemDescriptor = {
  platform: "neetcode",
  slug: "duplicate-integer",
  title: "Contains Duplicate",
  difficulty: "Easy",
  frontendId: null,
  listSlug: "neetcode150",
  metaIncomplete: false,
};

const LC_CONTAINS_DUPLICATE: ProblemDescriptor = {
  platform: "leetcode",
  slug: "contains-duplicate",
  title: "Contains Duplicate",
  difficulty: "Easy",
  frontendId: "217",
  listSlug: null,
  metaIncomplete: false,
};

function review(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    problemId: "leetcode:contains-duplicate",
    problem: NC_CONTAINS_DUPLICATE,
    mode: "seul",
    feel: 2,
    submissionsInSession: 2,
    minutesInSession: 12,
    ...overrides,
  };
}

function cardDue(id: string, due: string): ProblemCard {
  return {
    id,
    title: id,
    difficulty: "Easy",
    sources: {
      leetcode: {
        slug: id,
        frontendId: null,
        listSlug: null,
        difficulty: "Easy",
        lastSeenAt: due,
      },
    },
    lastMode: "seul",
    lastFeel: 2,
    fsrs: {
      due,
      stability: 1,
      difficulty: 5,
      reps: 1,
      lapses: 0,
      state: 2,
      last_review: null,
    },
    createdAt: due,
    updatedAt: due,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe("logReview", () => {
  it("écrit une carte unifiée et son entrée de log", async () => {
    const { scheduledDue } = await logReview(review());
    const card = (await getCards())["leetcode:contains-duplicate"];
    const log = await getLog();

    expect(card?.title).toBe("Contains Duplicate");
    expect(card?.difficulty).toBe("Easy");
    expect(card?.sources.neetcode?.slug).toBe("duplicate-integer");
    expect(card?.sources.neetcode?.listSlug).toBe("neetcode150");
    expect(card?.lastMode).toBe("seul");
    expect(card?.fsrs.due).toBe(scheduledDue);
    expect(log[0]?.problemId).toBe("leetcode:contains-duplicate");
    expect(log[0]?.platform).toBe("neetcode");
    expect(log[0]?.grade).toBe(3);
  });

  it("conserve createdAt et les sources déjà connues", async () => {
    await logReview(review());
    const created = (await getCards())["leetcode:contains-duplicate"]?.createdAt;
    await logReview(review({ problem: LC_CONTAINS_DUPLICATE, feel: 1 }));
    const card = (await getCards())["leetcode:contains-duplicate"];

    expect(card?.createdAt).toBe(created);
    expect(card?.sources.neetcode?.slug).toBe("duplicate-integer");
    expect(card?.sources.leetcode?.slug).toBe("contains-duplicate");
    expect(await getLog()).toHaveLength(2);
  });

  it("n'enregistre pas de ressenti pour un abandon", async () => {
    await logReview(review({ mode: "abandon", feel: null }));
    const card = (await getCards())["leetcode:contains-duplicate"];
    expect(card?.lastFeel).toBeNull();
    expect((await getLog())[0]?.grade).toBe(1);
  });

  it("solde seulement l'Accepted en attente du même problème", async () => {
    await setPendingAccepted({
      problemId: "leetcode:contains-duplicate",
      problem: NC_CONTAINS_DUPLICATE,
      submissionsInSession: 1,
      minutesInSession: 3,
      acceptedAt: new Date().toISOString(),
    });
    await logReview(review());
    expect((await getAllData()).pendingAccepted).toBeNull();

    await setPendingAccepted({
      problemId: "leetcode:valid-sudoku",
      problem: { ...LC_CONTAINS_DUPLICATE, slug: "valid-sudoku", title: "Valid Sudoku" },
      submissionsInSession: 1,
      minutesInSession: 3,
      acceptedAt: new Date().toISOString(),
    });
    await logReview(review());
    expect((await getAllData()).pendingAccepted?.problemId).toBe("leetcode:valid-sudoku");
  });
});

describe("fusion LeetCode / NeetCode", () => {
  it("résout les slugs différents vers la même carte et applique un cooldown commun", async () => {
    const nc = await prepareAccepted(NC_CONTAINS_DUPLICATE);
    expect(nc.problemId).toBe("leetcode:contains-duplicate");
    await logReview(review({ problemId: nc.problemId }));

    const lc = await prepareAccepted(LC_CONTAINS_DUPLICATE);
    expect(lc).toEqual({ problemId: "leetcode:contains-duplicate", underCooldown: true });
    const cards = await getCards();
    expect(Object.keys(cards)).toEqual(["leetcode:contains-duplicate"]);
    expect(cards[lc.problemId]?.sources.leetcode?.frontendId).toBe("217");
    expect(cards[lc.problemId]?.sources.neetcode?.slug).toBe("duplicate-integer");
  });

  it("ne bloque pas un autre problème", async () => {
    await logReview(review());
    expect(await checkCooldown("leetcode:valid-sudoku")).toEqual({ underCooldown: false });
  });

  it("laisse repasser une fois la fenêtre écoulée", async () => {
    await logReview(review());
    await saveSettingsPatch({ reviewCooldownHours: 0 });
    expect(await checkCooldown("leetcode:contains-duplicate")).toEqual({ underCooldown: false });
  });
});

describe("previewReview", () => {
  it("ordonne les échéances sans écrire", async () => {
    const easy = await previewReview("leetcode:contains-duplicate", "seul", 1);
    const hard = await previewReview("leetcode:contains-duplicate", "seul", 3);
    expect(new Date(easy.scheduledDue).getTime()).toBeGreaterThan(
      new Date(hard.scheduledDue).getTime(),
    );
    expect(await getCards()).toEqual({});
  });
});

describe("dueCards", () => {
  it("ne retient que les échéances passées, dans l'ordre", () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const cards = {
      hier: cardDue("hier", "2026-08-08T12:00:00.000Z"),
      demain: cardDue("demain", "2026-08-10T12:00:00.000Z"),
      "avant-hier": cardDue("avant-hier", "2026-08-07T12:00:00.000Z"),
    };
    expect(dueCards(cards, now).map((card) => card.id)).toEqual(["avant-hier", "hier"]);
  });
});

describe("réglages", () => {
  it("reporte le bandeau et fusionne les patches", async () => {
    await snoozeBanner();
    expect(new Date((await getAllData()).settings.bannerSnoozedUntil!).getTime()).toBeGreaterThan(
      Date.now(),
    );
    await saveSettingsPatch({ reviewCooldownHours: 12 });
    await saveSettingsPatch({ arracheCountsAsAgain: true });
    const settings = (await getAllData()).settings;
    expect(settings.reviewCooldownHours).toBe(12);
    expect(settings.arracheCountsAsAgain).toBe(true);
    expect(settings.requestRetention).toBe(0.9);
  });
});
