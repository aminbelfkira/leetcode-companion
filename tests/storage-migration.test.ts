import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { getAllData, migrateIfNeeded } from "../src/storage";

beforeEach(() => fakeBrowser.reset());

describe("migration du stockage NeetCode", () => {
  it("convertit les cartes, logs et Accepted v1 vers l'identité commune", async () => {
    const timestamp = "2026-08-09T12:00:00.000Z";
    await browser.storage.local.set({
      schemaVersion: 1,
      cards: {
        "duplicate-integer": {
          slug: "duplicate-integer",
          title: "Contains Duplicate",
          ncDifficulty: "Easy",
          listSlug: "neetcode150",
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
        },
      },
      log: [
        {
          ts: timestamp,
          slug: "duplicate-integer",
          mode: "seul",
          feel: 2,
          grade: 3,
          submissionsInSession: 1,
          minutesInSession: 4,
          scheduledDue: timestamp,
        },
      ],
      pendingAccepted: {
        slug: "duplicate-integer",
        title: "Contains Duplicate",
        ncDifficulty: "Easy",
        listSlug: "neetcode150",
        submissionsInSession: 1,
        minutesInSession: 4,
        acceptedAt: timestamp,
      },
    });

    await migrateIfNeeded();
    const data = await getAllData();
    const card = data.cards["leetcode:contains-duplicate"];

    expect(data.schemaVersion).toBe(2);
    expect(Object.keys(data.cards)).toEqual(["leetcode:contains-duplicate"]);
    expect(card?.sources.neetcode?.slug).toBe("duplicate-integer");
    expect(card?.sources.neetcode?.listSlug).toBe("neetcode150");
    expect(card?.fsrs.due).toBe(timestamp);
    expect(data.log[0]).toMatchObject({
      problemId: "leetcode:contains-duplicate",
      platform: "neetcode",
      grade: 3,
    });
    expect(data.pendingAccepted?.problemId).toBe("leetcode:contains-duplicate");
  });
});
