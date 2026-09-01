// Service worker (§4) : seul écrivain du storage, applique FSRS, badge.
// MV3 éphémère : aucun état mémoire supposé persistant.

import {
  ALARM_BADGE_DAILY,
  ALARM_BADGE_PERIODIC,
  ALARM_GITHUB_RETRY,
  ALARM_SUPABASE_SYNC,
  BADGE_COLOR,
  DAILY_ALARM_HOUR,
  DAILY_ALARM_MINUTE,
  GITHUB_RETRY_MINUTES,
  LOG_PREFIX,
  SUPABASE_SYNC_MINUTES,
} from "../src/config";
import {
  GithubApiError,
  GithubReauthorizationRequiredError,
  githubAuthNeedsRefresh,
  listGithubRepositories,
  pollGithubDeviceFlow,
  refreshGithubUserAccessToken,
  startGithubDeviceFlow,
} from "../src/github/api";
import { GITHUB_PERMISSION_ORIGINS } from "../src/github/config";
import {
  clearGithubAuth,
  clearGithubData,
  getGithubAuth,
  getGithubDeviceFlow,
  getGithubQueue,
  getGithubSyncState,
  getGithubSyncStatus,
  markGithubSynced,
  setGithubAuth,
  setGithubDeviceFlow,
  setGithubLastError,
  setGithubQueue,
  setGithubRepository,
} from "../src/github/storage";
import { githubSolutionPath, syncSubmissionToGithub } from "../src/github/sync";
import type {
  AcceptedSubmissionForSync,
  GithubAuthRecord,
  GithubDeviceFlowPoll,
} from "../src/github/types";
import {
  getCards,
  migrateIfNeeded,
  setPendingAccepted,
} from "../src/storage";
import {
  getSupabaseSyncStatus,
  signInSupabaseWithGithub,
  signOutSupabase,
  synchronizeSupabase,
} from "../src/supabase/sync";
import {
  checkCooldown,
  logReview,
  prepareAccepted,
  previewReview,
  snoozeBanner,
  updateCardMeta,
} from "../src/review";
import type { RuntimeRequest } from "../src/types";

export default defineBackground(() => {
  const githubReauthorizationMessage =
    "La connexion GitHub a expiré. Reconnectez GitHub pour reprendre la synchronisation.";

  console.log(`${LOG_PREFIX} background démarré`);

  const ready = migrateIfNeeded().then(updateBadge);
  void ready.catch((err) => console.error(`${LOG_PREFIX} migration`, err));

  // §8 — recalculs périodiques (jamais de setTimeout long en MV3).
  void browser.alarms.create(ALARM_BADGE_PERIODIC, { periodInMinutes: 60 });
  void browser.alarms.create(ALARM_BADGE_DAILY, {
    when: nextDailyAlarmTime(),
    periodInMinutes: 24 * 60,
  });
  void browser.alarms.create(ALARM_GITHUB_RETRY, {
    periodInMinutes: GITHUB_RETRY_MINUTES,
  });
  void browser.alarms.create(ALARM_SUPABASE_SYNC, {
    periodInMinutes: SUPABASE_SYNC_MINUTES,
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_BADGE_PERIODIC || alarm.name === ALARM_BADGE_DAILY) {
      void updateBadge();
    }
    if (alarm.name === ALARM_GITHUB_RETRY) {
      void serializedGithub(flushGithubQueue).catch((err: unknown) =>
        console.warn(`${LOG_PREFIX} GitHub retry`, err),
      );
    }
    if (alarm.name === ALARM_SUPABASE_SYNC) {
      void syncSupabaseBestEffort();
    }
  });

  /** Prochain 00:05 local (§8). */
  function nextDailyAlarmTime(): number {
    const next = new Date();
    next.setHours(DAILY_ALARM_HOUR, DAILY_ALARM_MINUTE, 0, 0);
    if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  /** Badge = nombre de cartes dues (due <= maintenant, retards inclus). */
  async function updateBadge(): Promise<void> {
    try {
      const cards = await getCards();
      const now = Date.now();
      const due = Object.values(cards).filter(
        (c) => new Date(c.fsrs.due).getTime() <= now,
      ).length;
      await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
      await browser.action.setBadgeText({ text: due > 0 ? String(due) : "" });
    } catch (err) {
      console.error(`${LOG_PREFIX} badge`, err);
    }
  }

  // Les mutations sont sérialisées : pas de read-modify-write entrelacés.
  let writeQueue: Promise<unknown> = Promise.resolve();
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeQueue.then(fn);
    writeQueue = next.catch(() => undefined);
    return next;
  }

  // Les appels réseau GitHub restent ordonnés sans bloquer les écritures FSRS.
  let githubQueue: Promise<unknown> = Promise.resolve();
  function serializedGithub<T>(fn: () => Promise<T>): Promise<T> {
    const next = githubQueue.then(fn);
    githubQueue = next.catch(() => undefined);
    return next;
  }

  // Auth, refresh token et ecritures distantes partagent une file pour ne
  // jamais utiliser deux fois le meme refresh token Supabase.
  let supabaseQueue: Promise<unknown> = Promise.resolve();
  function serializedSupabase<T>(fn: () => Promise<T>): Promise<T> {
    const next = supabaseQueue.then(fn);
    supabaseQueue = next.catch(() => undefined);
    return next;
  }

  async function syncSupabaseBestEffort(): Promise<void> {
    try {
      // La lecture/fusion/remplacement distant partage aussi le verrou FSRS :
      // une nouvelle review ne peut pas etre ecrasee pendant une requete lente.
      await serializedSupabase(() =>
        serialized(() => synchronizeSupabase(false)),
      );
      await updateBadge();
    } catch (error) {
      console.warn(`${LOG_PREFIX} Supabase sync`, error);
    }
  }

  void serializedGithub(flushGithubQueue).catch((err: unknown) =>
    console.warn(`${LOG_PREFIX} GitHub reprise`, err),
  );
  void ready.then(syncSupabaseBestEffort);

  browser.runtime.onMessage.addListener(
    (message: unknown, sender, sendResponse: (response: unknown) => void) => {
      handle(message as RuntimeRequest, sender)
        .then(sendResponse)
        .catch((err: unknown) => {
          console.error(`${LOG_PREFIX} message`, err);
          sendResponse({ error: err instanceof Error ? err.message : String(err) });
        });
      return true; // réponse asynchrone
    },
  );

  async function handle(msg: RuntimeRequest, sender: unknown): Promise<unknown> {
    await ready;
    switch (msg.kind) {
      case "STORAGE_READY":
        return { ok: true } as const;
      case "PREPARE_ACCEPTED": {
        const result = await serialized(() => prepareAccepted(msg.problem));
        await syncSupabaseBestEffort();
        return result;
      }
      case "CHECK_COOLDOWN":
        return checkCooldown(msg.problemId);
      case "PREVIEW_REVIEW":
        return previewReview(msg.problemId, msg.mode, msg.feel);
      case "LOG_REVIEW": {
        const result = await serialized(async () => {
          const result = await logReview(msg.review);
          await updateBadge();
          return result;
        });
        await syncSupabaseBestEffort();
        return result;
      }
      case "SET_PENDING_ACCEPTED": {
        const result = await serialized(async () => {
          await setPendingAccepted(msg.pending);
          return { ok: true } as const;
        });
        await syncSupabaseBestEffort();
        return result;
      }
      case "CLEAR_PENDING_ACCEPTED": {
        const result = await serialized(async () => {
          await setPendingAccepted(null);
          return { ok: true } as const;
        });
        await syncSupabaseBestEffort();
        return result;
      }
      case "UPDATE_CARD_META": {
        const result = await serialized(async () => {
          await updateCardMeta(msg.problem);
          return { ok: true } as const;
        });
        await syncSupabaseBestEffort();
        return result;
      }
      case "SNOOZE_BANNER": {
        const result = await serialized(async () => {
          await snoozeBanner();
          return { ok: true } as const;
        });
        await syncSupabaseBestEffort();
        return result;
      }
      case "SUPABASE_GET_STATUS":
        return serializedSupabase(getSupabaseSyncStatus);
      case "SUPABASE_SIGN_IN_GITHUB":
        assertExtensionSender(sender);
        return serializedSupabase(() =>
          serialized(signInSupabaseWithGithub),
        );
      case "SUPABASE_SIGN_OUT":
        assertExtensionSender(sender);
        return serializedSupabase(signOutSupabase);
      case "SUPABASE_SYNC_NOW":
        assertExtensionSender(sender);
        return serializedSupabase(() =>
          serialized(async () => {
            const status = await synchronizeSupabase();
            await updateBadge();
            return status;
          }),
        );
      case "GITHUB_GET_STATUS":
        return getGithubSyncStatus();
      case "GITHUB_START_DEVICE_FLOW":
        return serializedGithub(startDeviceAuthorization);
      case "GITHUB_POLL_DEVICE_FLOW":
        return serializedGithub(pollDeviceAuthorization);
      case "GITHUB_LIST_REPOSITORIES":
        return serializedGithub(async () => ({
          repositories: await accessibleGithubRepositories(),
        }));
      case "GITHUB_SELECT_REPOSITORY":
        return serializedGithub(async () => {
          const repositories = await accessibleGithubRepositories();
          const selected = repositories.find((repository) => repository.id === msg.repositoryId);
          if (selected === undefined) throw new Error("Dépôt GitHub inaccessible");
          await setGithubRepository(selected);
          await flushGithubQueue();
          return getGithubSyncStatus();
        });
      case "GITHUB_DISCONNECT":
        return serializedGithub(disconnectGithub);
      case "GITHUB_RETRY_QUEUE":
        return serializedGithub(async () => {
          await flushGithubQueue();
          return getGithubSyncStatus();
        });
      case "GITHUB_SYNC_SUBMISSION":
        if (!isLeetCodeSender(sender)) {
          throw new Error("GitHub Sync est réservé aux soumissions LeetCode");
        }
        return serializedGithub(() => enqueueGithubSubmission(msg.submission));
    }
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function isLeetCodeSender(sender: unknown): boolean {
    if (!isRecord(sender)) return false;
    const tab = isRecord(sender.tab) ? sender.tab : null;
    const candidate =
      typeof sender.url === "string"
        ? sender.url
        : tab !== null && typeof tab.url === "string"
          ? tab.url
          : null;
    if (candidate === null) return false;
    try {
      return new URL(candidate).origin === "https://leetcode.com";
    } catch {
      return false;
    }
  }

  function assertExtensionSender(sender: unknown): void {
    if (!isRecord(sender) || typeof sender.url !== "string") {
      throw new Error("Action Supabase réservée aux réglages de l'extension");
    }
    try {
      const extensionOrigin = new URL(browser.runtime.getURL("/")).origin;
      if (new URL(sender.url).origin !== extensionOrigin) throw new Error("origine");
    } catch {
      throw new Error("Action Supabase réservée aux réglages de l'extension");
    }
  }

  async function startDeviceAuthorization() {
    const { public: publicFlow, stored } = await startGithubDeviceFlow();
    await setGithubDeviceFlow(stored);
    return publicFlow;
  }

  async function pollDeviceAuthorization(): Promise<GithubDeviceFlowPoll> {
    const flow = await getGithubDeviceFlow();
    if (flow === null) throw new Error("Connexion GitHub expirée, recommencez");
    const result = await pollGithubDeviceFlow(flow);
    switch (result.state) {
      case "authorized":
        await setGithubAuth(result.auth);
        await setGithubDeviceFlow(null);
        await setGithubLastError(null);
        // Une reconnexion après expiration conserve le dépôt et la file : on reprend ici.
        await flushGithubQueue();
        return { state: "connected", userLogin: result.auth.userLogin };
      case "pending":
        await setGithubDeviceFlow({
          ...flow,
          nextPollAt: Date.now() + result.retryAfterSeconds * 1_000,
        });
        return result;
      case "slow_down": {
        const retryAfterSeconds = result.retryAfterSeconds;
        await setGithubDeviceFlow({
          ...flow,
          intervalSeconds: retryAfterSeconds,
          nextPollAt: Date.now() + retryAfterSeconds * 1_000,
        });
        return { state: "pending", retryAfterSeconds };
      }
      case "expired":
      case "denied":
        await setGithubDeviceFlow(null);
        return result;
      case "connected":
        return result;
    }
  }

  async function requireGithubReauthorization(): Promise<never> {
    // Ne jamais utiliser clearGithubData ici : le dépôt et le code en attente doivent survivre.
    await clearGithubAuth();
    await setGithubLastError(githubReauthorizationMessage);
    throw new GithubReauthorizationRequiredError(githubReauthorizationMessage);
  }

  async function refreshStoredGithubAuth(auth: GithubAuthRecord): Promise<GithubAuthRecord> {
    try {
      const refreshed = await refreshGithubUserAccessToken(auth);
      // Le refresh token est rotatif : le nouvel enregistrement remplace atomiquement l'ancien.
      await setGithubAuth(refreshed);
      return refreshed;
    } catch (error) {
      if (error instanceof GithubReauthorizationRequiredError) {
        return requireGithubReauthorization();
      }
      throw error;
    }
  }

  async function withGithubAuthentication<T>(
    operation: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    let auth = await getGithubAuth();
    if (auth === null) throw new Error("GitHub n'est pas connecté");
    if (githubAuthNeedsRefresh(auth)) auth = await refreshStoredGithubAuth(auth);

    try {
      return await operation(auth.accessToken);
    } catch (error) {
      if (!(error instanceof GithubApiError) || error.status !== 401) throw error;
    }

    // Le token peut avoir été révoqué ou avoir expiré entre deux requêtes.
    auth = await refreshStoredGithubAuth(auth);
    try {
      return await operation(auth.accessToken);
    } catch (error) {
      if (error instanceof GithubApiError && error.status === 401) {
        return requireGithubReauthorization();
      }
      throw error;
    }
  }

  async function accessibleGithubRepositories() {
    return withGithubAuthentication(listGithubRepositories);
  }

  async function disconnectGithub() {
    await clearGithubData();
    try {
      await browser.permissions.remove({ origins: [...GITHUB_PERMISSION_ORIGINS] });
    } catch {
      // La suppression des données suffit ; le retrait de permission est un bonus.
    }
    return getGithubSyncStatus();
  }

  function validateGithubSubmission(
    submission: AcceptedSubmissionForSync,
  ): AcceptedSubmissionForSync {
    if (!/^\d+$/.test(submission.submissionId)) throw new Error("ID de soumission invalide");
    if (!/^[a-z0-9-]+$/.test(submission.slug)) throw new Error("Slug LeetCode invalide");
    if (!/^[a-zA-Z0-9_+#.-]+$/.test(submission.language)) {
      throw new Error("Langage LeetCode invalide");
    }
    const collectionSlug = (submission as { collectionSlug?: unknown }).collectionSlug;
    if (
      collectionSlug !== undefined &&
      collectionSlug !== null &&
      (typeof collectionSlug !== "string" ||
        !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(collectionSlug))
    ) {
      throw new Error("Contexte LeetCode invalide");
    }
    if (submission.code.length === 0 || submission.code.length > 1_000_000) {
      throw new Error("Taille de solution invalide");
    }
    return { ...submission, collectionSlug: collectionSlug ?? null };
  }

  function githubQueueKey(submission: AcceptedSubmissionForSync): string {
    const collection = submission.collectionSlug ?? "solutions";
    return `${collection}:${submission.slug}:${submission.language.toLowerCase()}`;
  }

  async function enqueueGithubSubmission(submission: AcceptedSubmissionForSync) {
    const status = await getGithubSyncStatus();
    if (!status.enabled) {
      return { synced: false, pendingCount: status.pendingCount, path: null } as const;
    }
    const valid = validateGithubSubmission(submission);
    const key = githubQueueKey(valid);
    const queue = await getGithubQueue();
    queue[key] = { ...valid, queuedAt: new Date().toISOString() };
    await setGithubQueue(queue);
    await setGithubLastError(null);
    await flushGithubQueue();
    const remaining = await getGithubQueue();
    const synced = remaining[key] === undefined;
    return {
      synced,
      pendingCount: Object.keys(remaining).length,
      path: synced ? githubSolutionPath(valid) : null,
    };
  }

  async function flushGithubQueue(): Promise<void> {
    const [auth, state, queue] = await Promise.all([
      getGithubAuth(),
      getGithubSyncState(),
      getGithubQueue(),
    ]);
    if (auth === null || state.repository === null) return;
    const repository = state.repository;

    const entries = Object.entries(queue).sort(([, a], [, b]) =>
      a.queuedAt.localeCompare(b.queuedAt),
    );
    for (const [key, submission] of entries) {
      try {
        const path = await withGithubAuthentication((accessToken) =>
          syncSubmissionToGithub(
            accessToken,
            repository,
            submission,
          ),
        );
        delete queue[key];
        await setGithubQueue(queue);
        await markGithubSynced(path);
        console.log(`${LOG_PREFIX} GitHub synchronisé`, { path });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await setGithubLastError(message);
        console.warn(`${LOG_PREFIX} GitHub en attente`, { message });
        break;
      }
    }
  }

});
