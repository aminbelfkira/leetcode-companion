import assert from "node:assert/strict";
import { mergeSnapshots } from "../src/supabase/sync";
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type StorageShape } from "../src/storage";
import type { ProblemCard, ReviewLogEntry } from "../src/types";

const older = "2026-08-01T10:00:00.000Z";
const newer = "2026-08-02T10:00:00.000Z";

function card(updatedAt: string): ProblemCard {
  return {
    id: "leetcode:contains-duplicate",
    title: "Contains Duplicate",
    difficulty: "Easy",
    sources: {
      leetcode: {
        slug: "contains-duplicate",
        frontendId: "217",
        listSlug: null,
        difficulty: "Easy",
        lastSeenAt: older,
      },
    },
    lastMode: "seul",
    lastFeel: 2,
    fsrs: {
      due: newer,
      stability: 1,
      difficulty: 5,
      reps: 1,
      lapses: 0,
      state: 2,
      last_review: older,
    },
    createdAt: older,
    updatedAt,
  };
}

const entry: ReviewLogEntry = {
  ts: older,
  problemId: "leetcode:contains-duplicate",
  platform: "leetcode",
  mode: "seul",
  feel: 2,
  grade: 3,
  submissionsInSession: 1,
  minutesInSession: 5,
  scheduledDue: newer,
};

const local: StorageShape = {
  schemaVersion: SCHEMA_VERSION,
  cards: { "leetcode:contains-duplicate": card(newer) },
  log: [entry],
  settings: { ...DEFAULT_SETTINGS, reviewCooldownHours: 12 },
  pendingAccepted: null,
};
const remoteCard = card(older);
remoteCard.sources = {
  neetcode: {
    slug: "duplicate-integer",
    frontendId: null,
    listSlug: "neetcode150",
    difficulty: "Easy",
    lastSeenAt: newer,
  },
};
const remote: StorageShape = {
  schemaVersion: SCHEMA_VERSION,
  cards: { "leetcode:contains-duplicate": remoteCard },
  log: [entry, { ...entry, ts: newer, platform: "neetcode" }],
  settings: { ...DEFAULT_SETTINGS, reviewCooldownHours: 4 },
  pendingAccepted: null,
};

const localPreferred = mergeSnapshots(local, remote, true);
assert.equal(localPreferred.cards[remoteCard.id]?.updatedAt, newer);
assert.equal(
  localPreferred.cards[remoteCard.id]?.sources.neetcode?.slug,
  "duplicate-integer",
);
assert.equal(localPreferred.log.length, 2);
assert.equal(localPreferred.settings.reviewCooldownHours, 12);

const remotePreferred = mergeSnapshots(local, remote, false);
assert.equal(remotePreferred.settings.reviewCooldownHours, 4);

console.log("supabase-sync: ok");
