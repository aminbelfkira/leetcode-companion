import { describe, expect, it } from "vitest";
import { mergeBackup } from "../src/backup";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "../src/storage";
import type { BackupSnapshot, ProblemCard } from "../src/types";

const EARLY = "2026-08-01T10:00:00.000Z";
const LATE = "2026-08-10T10:00:00.000Z";

function fsrs(due = LATE): ProblemCard["fsrs"] {
  return {
    due,
    stability: 2,
    difficulty: 5,
    reps: 1,
    lapses: 0,
    state: 2,
    last_review: EARLY,
  };
}

function emptySnapshot(): BackupSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    cards: {},
    log: [],
    settings: { ...DEFAULT_SETTINGS },
    pendingAccepted: null,
  };
}

describe("import de sauvegarde", () => {
  it("fusionne les sources LeetCode et NeetCode puis déduplique un second import", () => {
    const current = emptySnapshot();
    current.settings.automaticBackupEnabled = true;
    current.settings.automaticBackupDirectoryName = "Mes sauvegardes";
    current.cards["leetcode:contains-duplicate"] = {
      id: "leetcode:contains-duplicate",
      title: "Contains Duplicate",
      difficulty: "Easy",
      sources: {
        leetcode: {
          slug: "contains-duplicate",
          frontendId: "217",
          listSlug: null,
          difficulty: "Easy",
          lastSeenAt: EARLY,
        },
      },
      lastMode: "seul",
      lastFeel: 2,
      fsrs: fsrs(),
      createdAt: EARLY,
      updatedAt: EARLY,
    };
    const imported = {
      schemaVersion: 2,
      cards: {
        "title:contains duplicate": {
          id: "title:contains duplicate",
          title: "Contains Duplicate",
          difficulty: "Easy",
          sources: {
            neetcode: {
              slug: "duplicate-integer",
              frontendId: "217",
              listSlug: "neetcode150",
              difficulty: "Easy",
              lastSeenAt: LATE,
            },
          },
          lastMode: "aide",
          lastFeel: 3,
          fsrs: fsrs("2026-08-20T10:00:00.000Z"),
          createdAt: LATE,
          updatedAt: LATE,
        },
      },
      log: [{
        ts: LATE,
        problemId: "title:contains duplicate",
        platform: "neetcode",
        mode: "aide",
        feel: 3,
        grade: 2,
        submissionsInSession: 2,
        minutesInSession: 8,
        scheduledDue: "2026-08-20T10:00:00.000Z",
      }],
      settings: {
        ...DEFAULT_SETTINGS,
        reviewCooldownHours: 12,
        automaticBackupEnabled: false,
        automaticBackupDirectoryName: "Dossier importé à ignorer",
      },
      pendingAccepted: null,
    };

    const first = mergeBackup(imported, current);
    const card = first.snapshot.cards["leetcode:contains-duplicate"];
    expect(first.summary).toEqual({ cardsAdded: 0, cardsUpdated: 1, logEntriesAdded: 1 });
    expect(card?.sources.leetcode?.slug).toBe("contains-duplicate");
    expect(card?.sources.neetcode?.slug).toBe("duplicate-integer");
    expect(card?.id).toBe("leetcode:contains-duplicate");
    expect(first.snapshot.settings.reviewCooldownHours).toBe(12);
    expect(first.snapshot.settings.automaticBackupEnabled).toBe(true);
    expect(first.snapshot.settings.automaticBackupDirectoryName).toBe("Mes sauvegardes");

    const second = mergeBackup(imported, first.snapshot);
    expect(second.summary.logEntriesAdded).toBe(0);
    expect(second.snapshot.log).toHaveLength(1);
  });

  it("importe le format v1 d'une ancienne extension", () => {
    const legacy = {
      schemaVersion: 1,
      cards: {
        "duplicate-integer": {
          slug: "duplicate-integer",
          title: "Contains Duplicate",
          ncDifficulty: "Easy",
          listSlug: "neetcode150",
          lastMode: "seul",
          lastFeel: 2,
          fsrs: fsrs(),
          createdAt: EARLY,
          updatedAt: LATE,
        },
      },
      log: [{
        ts: LATE,
        slug: "duplicate-integer",
        mode: "seul",
        feel: 2,
        grade: 3,
        submissionsInSession: 1,
        minutesInSession: 5,
        scheduledDue: LATE,
      }],
      pendingAccepted: null,
    };

    const result = mergeBackup(legacy, emptySnapshot());
    expect(result.summary).toEqual({ cardsAdded: 1, cardsUpdated: 0, logEntriesAdded: 1 });
    expect(result.snapshot.cards["leetcode:contains-duplicate"]?.sources.neetcode?.slug)
      .toBe("duplicate-integer");
    expect(result.snapshot.log[0]?.problemId).toBe("leetcode:contains-duplicate");
  });

  it("refuse une version inconnue", () => {
    expect(() => mergeBackup({ schemaVersion: 99, cards: {}, log: [] }, emptySnapshot()))
      .toThrow("Version de sauvegarde non prise en charge");
  });
});
