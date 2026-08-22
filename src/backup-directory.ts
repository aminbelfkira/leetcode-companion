import type { BackupSnapshot } from "./types";

export const BACKUP_FILENAME = "companion-backup.json";

const DATABASE_NAME = "companion-local-backup";
const DATABASE_VERSION = 1;
const STORE_NAME = "directory-handles";
const HANDLE_KEY = "automatic-backup";

type PermissionOptions = { mode: "readwrite" };

export interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options?: PermissionOptions): Promise<PermissionState>;
  requestPermission(options?: PermissionOptions): Promise<PermissionState>;
}

export type BackupDirectoryStatus =
  | { state: "missing" }
  | { state: "granted" | "prompt" | "denied"; directoryName: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB indisponible"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Erreur IndexedDB"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Erreur IndexedDB"));
    };
  });
}

export async function saveBackupDirectoryHandle(
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  await withStore("readwrite", (store) => store.put(handle, HANDLE_KEY));
}

export async function getBackupDirectoryHandle(): Promise<PermissionedDirectoryHandle | null> {
  const handle = await withStore<unknown>("readonly", (store) => store.get(HANDLE_KEY));
  return typeof handle === "object" && handle !== null && "getFileHandle" in handle
    ? (handle as PermissionedDirectoryHandle)
    : null;
}

export async function forgetBackupDirectoryHandle(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(HANDLE_KEY));
}

export async function getBackupDirectoryStatus(): Promise<BackupDirectoryStatus> {
  const handle = await getBackupDirectoryHandle();
  if (handle === null) return { state: "missing" };
  const state = await handle.queryPermission({ mode: "readwrite" });
  return { state, directoryName: handle.name };
}

/** Doit être appelée directement depuis un clic utilisateur. */
export async function requestBackupDirectoryPermission(): Promise<BackupDirectoryStatus> {
  const handle = await getBackupDirectoryHandle();
  if (handle === null) return { state: "missing" };
  let state = await handle.queryPermission({ mode: "readwrite" });
  if (state !== "granted") state = await handle.requestPermission({ mode: "readwrite" });
  return { state, directoryName: handle.name };
}

export async function writeBackupToDirectory(snapshot: BackupSnapshot): Promise<void> {
  const handle = await getBackupDirectoryHandle();
  if (handle === null) throw new Error("Aucun dossier de sauvegarde n'est sélectionné.");
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") {
    throw new Error("L'autorisation du dossier doit être réactivée depuis les réglages.");
  }
  const file = await handle.getFileHandle(BACKUP_FILENAME, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(snapshot, null, 2));
  await writable.close();
}
