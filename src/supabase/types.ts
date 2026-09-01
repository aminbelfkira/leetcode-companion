import type { SupabaseSyncStatus } from "../types";

export interface SupabaseSyncMeta {
  dirty: boolean;
  dirtyAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
}

export const DEFAULT_SUPABASE_SYNC_META: SupabaseSyncMeta = {
  dirty: false,
  dirtyAt: null,
  lastSyncAt: null,
  lastError: null,
  ownerUserId: null,
  ownerEmail: null,
};

export function publicSupabaseStatus(
  meta: SupabaseSyncMeta,
  available: boolean,
  connected: boolean,
  email: string | null,
  userLogin: string | null,
  redirectUrl: string | null,
): SupabaseSyncStatus {
  return {
    available,
    connected,
    email,
    userLogin,
    redirectUrl,
    dirty: meta.dirty,
    lastSyncAt: meta.lastSyncAt,
    lastError: meta.lastError,
  };
}
