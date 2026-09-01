import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { browser } from "wxt/browser";
import {
  SUPABASE_AUTH_STORAGE_KEY,
  SUPABASE_AVAILABLE,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from "./config";
import { withoutProviderTokens } from "./oauth";

let singleton: SupabaseClient | null = null;

const extensionStorage = {
  async getItem(key: string): Promise<string | null> {
    const value = (await browser.storage.local.get(key))[key];
    return typeof value === "string" ? value : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

export function getSupabaseClient(): SupabaseClient | null {
  if (!SUPABASE_AVAILABLE || SUPABASE_URL === null || SUPABASE_PUBLISHABLE_KEY === null) {
    return null;
  }
  if (singleton !== null) return singleton;
  singleton = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: extensionStorage,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
  return singleton;
}

export function supabaseOAuthRedirectUrl(): string {
  return browser.identity.getRedirectURL("supabase");
}

/** Le token GitHub du provider n'est pas necessaire apres l'echange OAuth. */
export async function discardPersistedProviderTokens(): Promise<void> {
  const stored = await extensionStorage.getItem(SUPABASE_AUTH_STORAGE_KEY);
  if (stored === null) return;
  const sanitized = withoutProviderTokens(stored);
  if (sanitized !== stored) {
    await extensionStorage.setItem(SUPABASE_AUTH_STORAGE_KEY, sanitized);
  }
}

/** Le service worker MV3 gere explicitement le renouvellement de session. */
export async function activeSupabaseSession(
  client: SupabaseClient,
): Promise<Session | null> {
  const current = await client.auth.getSession();
  if (current.error !== null) throw current.error;
  const session = current.data.session;
  if (session === null) return null;
  const expiresAtMs = (session.expires_at ?? 0) * 1_000;
  if (expiresAtMs > Date.now() + 60_000) return session;

  const refreshed = await client.auth.refreshSession({
    refresh_token: session.refresh_token,
  });
  if (refreshed.error !== null) throw refreshed.error;
  return refreshed.data.session;
}
