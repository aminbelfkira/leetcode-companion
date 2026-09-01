export interface OAuthCallback {
  code: string;
  flowId: string | null;
}

/** Valide strictement le callback chromiumapp avant l'echange PKCE. */
export function parseOAuthCallback(
  callbackUrl: string,
  expectedRedirectUrl: string,
  fallbackFlowId: string | null,
): OAuthCallback {
  const callback = new URL(callbackUrl);
  const expected = new URL(expectedRedirectUrl);
  if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
    throw new Error("Redirection OAuth GitHub inattendue.");
  }

  const fragment = new URLSearchParams(callback.hash.replace(/^#/, ""));
  const parameter = (name: string): string | null =>
    callback.searchParams.get(name) ?? fragment.get(name);
  const oauthError = parameter("error_description") ?? parameter("error");
  if (oauthError !== null) throw new Error(`GitHub OAuth : ${oauthError}`);

  const code = parameter("code");
  if (code === null || code.length === 0) {
    throw new Error("Code OAuth GitHub absent de la redirection.");
  }
  return {
    code,
    flowId: parameter("sb_flow_id") ?? fallbackFlowId,
  };
}

/** Supabase n'a besoin que de ses propres access/refresh tokens en local. */
export function withoutProviderTokens(serializedSession: string): string {
  try {
    const parsed = JSON.parse(serializedSession) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return serializedSession;
    }
    const session = parsed as Record<string, unknown>;
    if (!("provider_token" in session) && !("provider_refresh_token" in session)) {
      return serializedSession;
    }
    delete session.provider_token;
    delete session.provider_refresh_token;
    return JSON.stringify(session);
  } catch {
    return serializedSession;
  }
}
