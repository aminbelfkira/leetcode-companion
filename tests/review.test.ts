import { fakeBrowser } from "wxt/testing";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkCooldown,
  dueCards,
  logReview,
  previewReview,
  saveSettingsPatch,
  snoozeBanner,
} from "../src/review";
import { getAllData, getCards, getLog, setPendingAccepted } from "../src/storage";
import type { ProblemCard, ReviewInput } from "../src/types";

function review(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    slug: "duplicate-integer",
    title: "Contains Duplicate",
    ncDifficulty: "Easy",
    listSlug: "neetcode150",
    metaIncomplete: false,
    mode: "seul",
    feel: 2,
    submissionsInSession: 2,
    minutesInSession: 12,
    ...overrides,
  };
}

function cardDue(slug: string, due: string): ProblemCard {
  return {
    slug,
    title: slug,
    ncDifficulty: "Easy",
    listSlug: null,
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
  it("écrit la carte et son entrée de log ensemble", async () => {
    const { scheduledDue } = await logReview(review());

    const cards = await getCards();
    const log = await getLog();
    const card = cards["duplicate-integer"];

    expect(card?.title).toBe("Contains Duplicate");
    expect(card?.ncDifficulty).toBe("Easy");
    expect(card?.listSlug).toBe("neetcode150");
    expect(card?.lastMode).toBe("seul");
    expect(card?.lastFeel).toBe(2);
    expect(card?.fsrs.due).toBe(scheduledDue);

    expect(log).toHaveLength(1);
    expect(log[0]?.grade).toBe(3); // ressenti 2 → Good
    expect(log[0]?.scheduledDue).toBe(scheduledDue);
    expect(log[0]?.submissionsInSession).toBe(2);
  });

  it("conserve createdAt et le contexte de liste d'une carte existante", async () => {
    await logReview(review());
    const created = (await getCards())["duplicate-integer"]?.createdAt;

    await logReview(review({ listSlug: null, feel: 1 }));
    const card = (await getCards())["duplicate-integer"];

    expect(card?.createdAt).toBe(created);
    expect(card?.listSlug).toBe("neetcode150");
    expect(await getLog()).toHaveLength(2);
  });

  it("n'enregistre pas de ressenti pour un abandon", async () => {
    await logReview(review({ mode: "abandon", feel: null }));
    const card = (await getCards())["duplicate-integer"];
    expect(card?.lastFeel).toBeNull();
    expect((await getLog())[0]?.grade).toBe(1);
  });

  it("marque les cartes dont les métadonnées viennent du repli DOM", async () => {
    await logReview(review({ metaIncomplete: true }));
    expect((await getCards())["duplicate-integer"]?.metaIncomplete).toBe(true);
  });

  it("solde l'Accepted en attente du même problème", async () => {
    await setPendingAccepted({
      slug: "duplicate-integer",
      title: "Contains Duplicate",
      ncDifficulty: "Easy",
      listSlug: null,
      submissionsInSession: 1,
      minutesInSession: 3,
      acceptedAt: new Date().toISOString(),
    });

    await logReview(review());

    expect((await getAllData()).pendingAccepted).toBeNull();
  });

  it("laisse en place un Accepted en attente sur un autre problème", async () => {
    await setPendingAccepted({
      slug: "valid-sudoku",
      title: "Valid Sudoku",
      ncDifficulty: "Medium",
      listSlug: null,
      submissionsInSession: 1,
      minutesInSession: 3,
      acceptedAt: new Date().toISOString(),
    });

    await logReview(review());

    expect((await getAllData()).pendingAccepted?.slug).toBe("valid-sudoku");
  });
});

describe("checkCooldown", () => {
  it("laisse passer un problème jamais suivi", async () => {
    expect(await checkCooldown("duplicate-integer")).toEqual({ underCooldown: false });
  });

  it("bloque un second Accepted immédiat", async () => {
    await logReview(review());
    expect(await checkCooldown("duplicate-integer")).toEqual({ underCooldown: true });
  });

  it("ne bloque pas les autres problèmes", async () => {
    await logReview(review());
    expect(await checkCooldown("valid-sudoku")).toEqual({ underCooldown: false });
  });

  it("laisse repasser une fois la fenêtre écoulée", async () => {
    await logReview(review());
    await saveSettingsPatch({ reviewCooldownHours: 0 });
    expect(await checkCooldown("duplicate-integer")).toEqual({ underCooldown: false });
  });
});

describe("previewReview", () => {
  it("annonce la même échéance que celle réellement enregistrée", async () => {
    // Le fuzz FSRS est actif : on compare le rang, pas la valeur exacte.
    const easy = await previewReview("duplicate-integer", "seul", 1);
    const hard = await previewReview("duplicate-integer", "seul", 3);
    expect(new Date(easy.scheduledDue).getTime()).toBeGreaterThan(
      new Date(hard.scheduledDue).getTime(),
    );
  });

  it("n'écrit rien", async () => {
    await previewReview("duplicate-integer", "seul", 2);
    expect(await getCards()).toEqual({});
    expect(await getLog()).toEqual([]);
  });
});

describe("dueCards", () => {
  it("ne retient que les échéances passées, de la plus ancienne à la plus récente", () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const cards = {
      hier: cardDue("hier", "2026-08-08T12:00:00.000Z"),
      demain: cardDue("demain", "2026-08-10T12:00:00.000Z"),
      "avant-hier": cardDue("avant-hier", "2026-08-07T12:00:00.000Z"),
    };
    expect(dueCards(cards, now).map((card) => card.slug)).toEqual(["avant-hier", "hier"]);
  });

  it("renvoie une liste vide sans carte", () => {
    expect(dueCards({}, Date.now())).toEqual([]);
  });
});

describe("snoozeBanner", () => {
  it("reporte le bandeau à un instant futur du même jour ou du lendemain", async () => {
    await snoozeBanner();
    const { settings } = await getAllData();
    expect(settings.bannerSnoozedUntil).not.toBeNull();
    expect(new Date(settings.bannerSnoozedUntil!).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("saveSettingsPatch", () => {
  it("fusionne le patch avec les réglages existants", async () => {
    await saveSettingsPatch({ reviewCooldownHours: 12 });
    await saveSettingsPatch({ arracheCountsAsAgain: true });
    const { settings } = await getAllData();
    expect(settings.reviewCooldownHours).toBe(12);
    expect(settings.arracheCountsAsAgain).toBe(true);
    expect(settings.requestRetention).toBe(0.9); // valeur par défaut préservée
  });
});
