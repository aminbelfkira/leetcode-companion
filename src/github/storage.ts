import { browser } from "wxt/browser";
import { GITHUB_CLIENT_ID, GITHUB_INSTALLATION_URL } from "./config";
import type {
  GithubAuthRecord,
  GithubDeviceFlowRecord,
  GithubQueueItem,
  GithubRepository,
  GithubSyncState,
  GithubSyncStatus,
} from "./types";

const AUTH_KEY = "githubAuth";
const STATE_KEY = "githubSyncState";
const QUEUE_KEY = "githubSyncQueue";
const DEVICE_FLOW_KEY = "githubDeviceFlow";

const DEFAULT_STATE: GithubSyncState = {
  repository: null,
  lastSyncAt: null,
  lastSyncedPath: null,
  lastError: null,
};

async function read<T>(key: string): Promise<T | null> {
  const result = await browser.storage.local.get(key);
  return (result[key] as T | undefined) ?? null;
}

export async function getGithubAuth(): Promise<GithubAuthRecord | null> {
  return read<GithubAuthRecord>(AUTH_KEY);
}

export async function setGithubAuth(auth: GithubAuthRecord): Promise<void> {
  await browser.storage.local.set({ [AUTH_KEY]: auth });
}

export async function getGithubSyncState(): Promise<GithubSyncState> {
  return { ...DEFAULT_STATE, ...((await read<GithubSyncState>(STATE_KEY)) ?? {}) };
}

export async function setGithubRepository(repository: GithubRepository): Promise<void> {
  const state = await getGithubSyncState();
  await browser.storage.local.set({
    [STATE_KEY]: { ...state, repository, lastError: null } satisfies GithubSyncState,
  });
}

export async function setGithubLastError(message: string | null): Promise<void> {
  const state = await getGithubSyncState();
  await browser.storage.local.set({
    [STATE_KEY]: { ...state, lastError: message } satisfies GithubSyncState,
  });
}

export async function markGithubSynced(path: string): Promise<void> {
  const state = await getGithubSyncState();
  await browser.storage.local.set({
    [STATE_KEY]: {
      ...state,
      lastSyncAt: new Date().toISOString(),
      lastSyncedPath: path,
      lastError: null,
    } satisfies GithubSyncState,
  });
}

export async function getGithubQueue(): Promise<Record<string, GithubQueueItem>> {
  return (await read<Record<string, GithubQueueItem>>(QUEUE_KEY)) ?? {};
}

export async function setGithubQueue(queue: Record<string, GithubQueueItem>): Promise<void> {
  await browser.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function getGithubDeviceFlow(): Promise<GithubDeviceFlowRecord | null> {
  return read<GithubDeviceFlowRecord>(DEVICE_FLOW_KEY);
}

export async function setGithubDeviceFlow(flow: GithubDeviceFlowRecord | null): Promise<void> {
  if (flow === null) {
    await browser.storage.local.remove(DEVICE_FLOW_KEY);
    return;
  }
  await browser.storage.local.set({ [DEVICE_FLOW_KEY]: flow });
}

/** Les credentials et le code en attente ne font jamais partie de l'export FSRS. */
export async function clearGithubData(): Promise<void> {
  await browser.storage.local.remove([AUTH_KEY, STATE_KEY, QUEUE_KEY, DEVICE_FLOW_KEY]);
}

export async function getGithubSyncStatus(): Promise<GithubSyncStatus> {
  const [auth, state, queue] = await Promise.all([
    getGithubAuth(),
    getGithubSyncState(),
    getGithubQueue(),
  ]);
  const connected = auth !== null;
  return {
    available: GITHUB_CLIENT_ID.length > 0 && GITHUB_INSTALLATION_URL !== null,
    connected,
    enabled: connected && state.repository !== null,
    userLogin: auth?.userLogin ?? null,
    repository: state.repository,
    pendingCount: Object.keys(queue).length,
    lastSyncAt: state.lastSyncAt,
    lastSyncedPath: state.lastSyncedPath,
    lastError: state.lastError,
    installationUrl: GITHUB_INSTALLATION_URL,
  };
}
