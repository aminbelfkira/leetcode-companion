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

/** Le token ne peut plus être renouvelé : une nouvelle autorisation utilisateur est requise. */
export class GithubReauthorizationRequiredError extends Error {
  constructor(message = "La connexion GitHub a expiré. Reconnectez GitHub pour reprendre la synchronisation.") {
    super(message);
    this.name = "GithubReauthorizationRequiredError";
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function expirationFromNow(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  const seconds = requiredNumber(value, field);
  if (seconds <= 0) throw new Error(`Réponse GitHub invalide (${field})`);
  return new Date(Date.now() + seconds * 1_000).toISOString();
}

function oauthErrorMessage(body: Record<string, unknown>): string {
  if (typeof body.error_description === "string" && body.error_description.length > 0) {
    return body.error_description;
  }
  return typeof body.error === "string" ? body.error : "Réponse OAuth GitHub invalide";
}

function authFromTokenResponse(
  body: Record<string, unknown>,
  userLogin: string,
  connectedAt: string,
): GithubAuthRecord {
  const accessToken = requiredString(body.access_token, "access_token");
  const expiresAt = expirationFromNow(body.expires_in, "expires_in");
  const refreshToken = optionalString(body.refresh_token);
  const refreshTokenExpiresAt = expirationFromNow(
    body.refresh_token_expires_in,
    "refresh_token_expires_in",
  );
  if (expiresAt !== null && refreshToken === null) {
    throw new Error("Réponse GitHub invalide (refresh_token)");
  }
  if (refreshToken !== null && refreshTokenExpiresAt === null) {
    throw new Error("Réponse GitHub invalide (refresh_token_expires_in)");
  }
  const tokenType =
    typeof body.token_type === "string" && body.token_type.length > 0
      ? body.token_type
      : "bearer";
  return {
    accessToken,
    expiresAt,
    refreshToken,
    refreshTokenExpiresAt,
    tokenType,
    userLogin,
    connectedAt,
  };
}

export function githubAuthNeedsRefresh(
  auth: GithubAuthRecord,
  now = Date.now(),
  skewMilliseconds = 5 * 60 * 1_000,
): boolean {
  // Les anciens enregistrements ne possèdent pas encore expiresAt : leur premier 401
  // déclenchera une reconnexion qui préservera la file locale.
  if (typeof auth.expiresAt !== "string") return false;
  const expiresAt = Date.parse(auth.expiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= now + Math.max(0, skewMilliseconds);
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
  const user = await githubApiJson<unknown>("/user", accessToken);
  if (!isRecord(user)) throw new Error("Profil GitHub invalide");
  const userLogin = requiredString(user.login, "user.login");
  return {
    state: "authorized",
    auth: authFromTokenResponse(body, userLogin, new Date().toISOString()),
  };
}

/**
 * Renouvelle un user access token créé par Device Flow.
 * GitHub n'exige pas de client_secret dans ce cas, ce qui convient à une extension publique.
 */
export async function refreshGithubUserAccessToken(
  auth: GithubAuthRecord,
): Promise<GithubAuthRecord> {
  if (typeof auth.refreshToken !== "string" || auth.refreshToken.length === 0) {
    throw new GithubReauthorizationRequiredError();
  }
  if (typeof auth.refreshTokenExpiresAt === "string") {
    const refreshExpiresAt = Date.parse(auth.refreshTokenExpiresAt);
    if (!Number.isFinite(refreshExpiresAt) || refreshExpiresAt <= Date.now()) {
      throw new GithubReauthorizationRequiredError();
    }
  }

  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
    }),
  });
  if (!response.ok) throw await responseError(response);
  const body = (await response.json()) as unknown;
  if (!isRecord(body)) throw new Error("Réponse GitHub refresh invalide");
  if (typeof body.error === "string") {
    const message = oauthErrorMessage(body);
    if (["bad_refresh_token", "expired_token", "access_denied"].includes(body.error)) {
      throw new GithubReauthorizationRequiredError(message);
    }
    throw new Error(message);
  }

  return authFromTokenResponse(body, auth.userLogin, auth.connectedAt);
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
