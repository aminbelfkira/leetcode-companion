import { BACKUP_FILENAME, writeBackupToDirectory } from "./backup-directory";
import { getAllData, getSettings, setSettings } from "./storage";

export async function writeBackupNow(): Promise<{ filename: string }> {
  const snapshot = await getAllData();
  const savedAt = new Date().toISOString();
  const settings = {
    ...snapshot.settings,
    automaticBackupLastAt: savedAt,
    automaticBackupLastError: null,
  };
  try {
    await writeBackupToDirectory({ ...snapshot, settings });
    await setSettings(settings);
    return { filename: BACKUP_FILENAME };
  } catch (error) {
    await setSettings({
      ...snapshot.settings,
      automaticBackupLastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Une panne de sauvegarde locale ne doit jamais annuler une révision validée. */
export async function maybeWriteAutomaticBackup(): Promise<void> {
  const settings = await getSettings();
  if (!settings.automaticBackupEnabled) return;
  try {
    await writeBackupNow();
  } catch {
    // writeBackupNow conserve déjà le message d'erreur visible dans les réglages.
  }
}
