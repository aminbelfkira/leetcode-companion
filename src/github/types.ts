export interface AcceptedSubmissionForSync {
  submissionId: string;
  slug: string;
  frontendId: string;
  title: string;
  language: string;
  languageDisplay: string;
  code: string;
  runtimeDisplay: string | null;
  runtimePercentile: number | null;
  memoryDisplay: string | null;
  memoryPercentile: number | null;
  acceptedAt: string;
}

export interface GithubRepository {
  id: number;
  installationId: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

export interface GithubSyncState {
  repository: GithubRepository | null;
  lastSyncAt: string | null;
  lastSyncedPath: string | null;
  lastError: string | null;
}

export interface GithubSyncStatus {
  available: boolean;
  connected: boolean;
  enabled: boolean;
  userLogin: string | null;
  repository: GithubRepository | null;
  pendingCount: number;
  lastSyncAt: string | null;
  lastSyncedPath: string | null;
  lastError: string | null;
  installationUrl: string | null;
}

export interface GithubDeviceFlowStart {
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
}

export type GithubDeviceFlowPoll =
  | { state: "pending"; retryAfterSeconds: number }
  | { state: "connected"; userLogin: string }
  | { state: "expired" | "denied" };

export interface GithubQueueItem extends AcceptedSubmissionForSync {
  queuedAt: string;
}

export interface GithubAuthRecord {
  accessToken: string;
  tokenType: string;
  userLogin: string;
  connectedAt: string;
}

export interface GithubDeviceFlowRecord {
  deviceCode: string;
  expiresAt: string;
  intervalSeconds: number;
  nextPollAt: number;
}
