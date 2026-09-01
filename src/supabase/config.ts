const rawUrl = import.meta.env.WXT_SUPABASE_URL?.trim() ?? "";
const rawPublishableKey =
  import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  import.meta.env.WXT_SUPABASE_ANON_KEY?.trim() ||
  "";

function validSupabaseUrl(value: string): string | null {
  if (value.length === 0) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Ces deux valeurs sont publiques et sont integrees au build de l'extension. */
export const SUPABASE_URL = validSupabaseUrl(rawUrl);
export const SUPABASE_PUBLISHABLE_KEY = rawPublishableKey || null;
export const SUPABASE_AVAILABLE =
  SUPABASE_URL !== null && SUPABASE_PUBLISHABLE_KEY !== null;

export const SUPABASE_TABLE = "companion_snapshots";
export const SUPABASE_AUTH_STORAGE_KEY = "companionSupabaseAuth";
export const SUPABASE_SYNC_META_KEY = "supabaseSyncMeta";
