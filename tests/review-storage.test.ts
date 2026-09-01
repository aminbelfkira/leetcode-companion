import assert from "node:assert/strict";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing";
import {
  checkCooldown,
  dueCards,
  logReview,
  prepareAccepted,
} from "../src/review";
import { getAllData, getCards, migrateIfNeeded } from "../src/storage";
import type { ProblemCard, ProblemDescriptor } from "../src/types";

const timestamp = "2026-08-09T12:00:00.000Z";
const fsrs: ProblemCard["fsrs"] = {
  due: timestamp,
  stability: 1,
  difficulty: 5,
  reps: 1,
  lapses: 0,
  state: 2,
  last_review: timestamp,
};

// La migration de main v1 doit convertir toutes les références et laisser les
// quatre espaces de stockage GitHub strictement intacts.
fakeBrowser.reset();
const githubSentinels = {
  githubAuth: { accessToken: "token-sentinel", refreshToken: "refresh-sentinel" },
  githubSyncState: { repository: { id: 42 }, lastError: "state-sentinel" },
  githubSyncQueue: { queued: { code: "code-sentinel" } },
  githubDeviceFlow: { deviceCode: "device-sentinel" },
};
const privateSentinels = {
  ...githubSentinels,
  companionSupabaseAuth: JSON.stringify({ access_token: "supabase-token-sentinel" }),
};
await browser.storage.local.set({
  schemaVersion: 1,
  cards: {
    "contains-duplicate": {
      slug: "contains-duplicate",
      frontendId: "217",
      title: "Contains Duplicate",
      lcDifficulty: "Easy",
      lastMode: "seul",
      lastFeel: 2,
      fsrs,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  },
  log: [
    {
      ts: timestamp,
      slug: "contains-duplicate",
      mode: "seul",
      feel: 2,
      grade: 3,
      submissionsInSession: 1,
      minutesInSession: 4,
      scheduledDue: timestamp,
    },
  ],
  pendingAccepted: {
    slug: "contains-duplicate",
    frontendId: "217",
    title: "Contains Duplicate",
    lcDifficulty: "Easy",
    submissionsInSession: 1,
    minutesInSession: 4,
    acceptedAt: timestamp,
  },
  ...privateSentinels,
});

await migrateIfNeeded();
const migrated = await getAllData();
const migratedCard = migrated.cards["leetcode:contains-duplicate"];
assert.equal(migrated.schemaVersion, 2);
assert.deepEqual(Object.keys(migrated.cards), ["leetcode:contains-duplicate"]);
assert.equal(migratedCard?.sources.leetcode?.slug, "contains-duplicate");
assert.equal(migratedCard?.sources.leetcode?.frontendId, "217");
assert.equal(migratedCard?.fsrs.due, timestamp);
assert.deepEqual(migrated.log[0], {
  ts: timestamp,
  problemId: "leetcode:contains-duplicate",
  platform: "leetcode",
  mode: "seul",
  feel: 2,
  grade: 3,
  submissionsInSession: 1,
  minutesInSession: 4,
  scheduledDue: timestamp,
});
assert.equal(migrated.pendingAccepted?.problemId, "leetcode:contains-duplicate");
assert.doesNotMatch(
  JSON.stringify(migrated),
  /token-sentinel|code-sentinel|supabase-token-sentinel/,
);
const privateAfterMigration = await browser.storage.local.get(Object.keys(privateSentinels));
assert.deepEqual(privateAfterMigration, privateSentinels);

// Une résolution sur l'autre plateforme enrichit la même carte et possède son
// propre cooldown, sans écrire dans les clés GitHub.
fakeBrowser.reset();
await migrateIfNeeded();
await browser.storage.local.set(privateSentinels);

const neetcode: ProblemDescriptor = {
  platform: "neetcode",
  slug: "duplicate-integer",
  title: "Contains Duplicate",
  difficulty: "Easy",
  frontendId: null,
  listSlug: "neetcode150",
  metaIncomplete: false,
};
const leetcode: ProblemDescriptor = {
  platform: "leetcode",
  slug: "contains-duplicate",
  title: "Contains Duplicate",
  difficulty: "Easy",
  frontendId: "217",
  listSlug: null,
  metaIncomplete: false,
};

const preparedNeetcode = await prepareAccepted(neetcode);
assert.deepEqual(preparedNeetcode, {
  problemId: "leetcode:contains-duplicate",
  underCooldown: false,
});
await logReview({
  problemId: preparedNeetcode.problemId,
  problem: neetcode,
  mode: "seul",
  feel: 2,
  submissionsInSession: 2,
  minutesInSession: 12,
});

const preparedLeetcode = await prepareAccepted(leetcode);
assert.equal(preparedLeetcode.problemId, preparedNeetcode.problemId);
assert.equal(preparedLeetcode.underCooldown, false);
assert.equal((await prepareAccepted(neetcode)).underCooldown, true);
assert.deepEqual(await checkCooldown(preparedNeetcode.problemId, "leetcode"), {
  underCooldown: false,
});

const unified = (await getCards())[preparedNeetcode.problemId];
assert.equal(unified?.sources.neetcode?.slug, "duplicate-integer");
assert.equal(unified?.sources.leetcode?.slug, "contains-duplicate");
assert.equal(dueCards(await getCards(), Number.POSITIVE_INFINITY).length, 1);
assert.deepEqual(
  await browser.storage.local.get(Object.keys(privateSentinels)),
  privateSentinels,
);
const syncMetaAfterReview = (await browser.storage.local.get("supabaseSyncMeta"))
  .supabaseSyncMeta as { dirty?: unknown };
assert.equal(syncMetaAfterReview.dirty, true);

console.log("review-storage: ok");
