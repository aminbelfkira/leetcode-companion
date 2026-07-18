export const GITHUB_API_ROOT = "https://api.github.com";
export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_VERSION = "2022-11-28";

/**
 * Identifiants publics de la GitHub App officielle. Ils sont volontairement
 * embarqués dans l'extension : aucun client_secret ni aucune clé privée ne sont requis.
 */
export const GITHUB_CLIENT_ID = "Iv23li2ck926gmzxSkow";
export const GITHUB_APP_SLUG = "leetcode-companion-aminbelfkira";

export const GITHUB_INSTALLATION_URL =
  GITHUB_APP_SLUG.length > 0
    ? `https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new`
    : null;

export const GITHUB_PERMISSION_ORIGINS = [
  "https://github.com/*",
  "https://api.github.com/*",
] as const;
