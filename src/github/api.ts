import {
  GITHUB_ACCESS_TOKEN_URL,
  GITHUB_API_ROOT,
  GITHUB_API_VERSION,
  GITHUB_CLIENT_ID,
  GITHUB_DEVICE_CODE_URL,
} from "./config";
import type {
  GithubAuthRecord,
  GithubDeviceFlowPoll,
  GithubDeviceFlowRecord,
  GithubDeviceFlowStart,
  GithubRepository,
} from "./types";

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Réponse GitHub invalide (${field})`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Réponse GitHub invalide (${field})`);
  }
  return value;
}

async function responseError(response: Response): Promise<GithubApiError> {
  let message = `GitHub HTTP ${response.status}`;
  try {
    const body = (await response.json()) as unknown;
    if (isRecord(body) && typeof body.message === "string") message = body.message;
  } catch {
    // Le statut HTTP reste suffisamment explicite.
  }
  return new GithubApiError(message, response.status);
}

export async function githubApiJson<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${GITHUB_API_ROOT}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw await responseError(response);
  return (await response.json()) as T;
}

export async function startGithubDeviceFlow(): Promise<{
  public: GithubDeviceFlowStart;
  stored: GithubDeviceFlowRecord;
}> {
  if (GITHUB_CLIENT_ID.length === 0) {
    throw new Error("GitHub Sync n'est pas configuré dans ce build");
  }
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: GITHUB_CLIENT_ID }),
  });
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as unknown;
  if (!isRecord(body)) throw new Error("Réponse GitHub Device Flow invalide");

  const deviceCode = requiredString(body.device_code, "device_code");
  const userCode = requiredString(body.user_code, "user_code");
  const verificationUri = requiredString(body.verification_uri, "verification_uri");
  const expiresIn = requiredNumber(body.expires_in, "expires_in");
  const intervalSeconds = Math.max(5, requiredNumber(body.interval, "interval"));
  const expiresAt = new Date(Date.now() + expiresIn * 1_000).toISOString();
  return {
    public: { userCode, verificationUri, expiresAt, intervalSeconds },
    stored: {
      deviceCode,
      expiresAt,
      intervalSeconds,
      nextPollAt: Date.now() + intervalSeconds * 1_000,
    },
  };
}

export async function pollGithubDeviceFlow(
  flow: GithubDeviceFlowRecord,
): Promise<
  | GithubDeviceFlowPoll
  | { state: "authorized"; auth: GithubAuthRecord }
  | { state: "slow_down"; retryAfterSeconds: number }
> {
  if (new Date(flow.expiresAt).getTime() <= Date.now()) return { state: "expired" };
  if (Date.now() < flow.nextPollAt) {
    return {
      state: "pending",
      retryAfterSeconds: Math.max(1, Math.ceil((flow.nextPollAt - Date.now()) / 1_000)),
    };
  }

  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      device_code: flow.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as unknown;
  if (!isRecord(body)) throw new Error("Réponse GitHub token invalide");

  if (typeof body.error === "string") {
    switch (body.error) {
      case "authorization_pending":
        return { state: "pending", retryAfterSeconds: flow.intervalSeconds };
      case "slow_down":
        return { state: "slow_down", retryAfterSeconds: flow.intervalSeconds + 5 };
      case "expired_token":
        return { state: "expired" };
      case "access_denied":
        return { state: "denied" };
      default:
        throw new Error(
          typeof body.error_description === "string" ? body.error_description : body.error,
        );
    }
  }

  const accessToken = requiredString(body.access_token, "access_token");
  const tokenType =
    typeof body.token_type === "string" && body.token_type.length > 0
      ? body.token_type
      : "bearer";
  const user = await githubApiJson<unknown>("/user", accessToken);
  if (!isRecord(user)) throw new Error("Profil GitHub invalide");
  const userLogin = requiredString(user.login, "user.login");
  return {
    state: "authorized",
    auth: {
      accessToken,
      tokenType,
      userLogin,
      connectedAt: new Date().toISOString(),
    },
  };
}

export async function listGithubRepositories(token: string): Promise<GithubRepository[]> {
  const installations = await githubApiJson<unknown>(
    "/user/installations?per_page=100",
    token,
  );
  if (!isRecord(installations) || !Array.isArray(installations.installations)) {
    throw new Error("Installations GitHub invalides");
  }

  const groups = await Promise.all(
    installations.installations.map(async (installation): Promise<GithubRepository[]> => {
      if (!isRecord(installation) || typeof installation.id !== "number") return [];
      const installationId = installation.id;
      const result = await githubApiJson<unknown>(
        `/user/installations/${installationId}/repositories?per_page=100`,
        token,
      );
      if (!isRecord(result) || !Array.isArray(result.repositories)) return [];
      return result.repositories.flatMap((repository): GithubRepository[] => {
        if (!isRecord(repository) || !isRecord(repository.owner)) return [];
        const { id, name, full_name: fullName, default_branch: defaultBranch } = repository;
        const owner = repository.owner.login;
        if (
          typeof id !== "number" ||
          typeof name !== "string" ||
          typeof fullName !== "string" ||
          typeof defaultBranch !== "string" ||
          typeof owner !== "string"
        ) {
          return [];
        }
        return [
          {
            id,
            installationId,
            owner,
            name,
            fullName,
            defaultBranch,
            private: repository.private === true,
          },
        ];
      });
    }),
  );

  return groups
    .flat()
    .sort((a, b) => a.fullName.localeCompare(b.fullName, undefined, { sensitivity: "base" }));
}
