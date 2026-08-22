// Réglages FSRS. Lecture directe du storage, écriture via le background.

import { browser } from "wxt/browser";
import {
  BACKUP_FILENAME,
  forgetBackupDirectoryHandle,
  getBackupDirectoryStatus,
  readExistingBackup,
  requestBackupDirectoryPermission,
  saveBackupDirectoryHandle,
  type BackupDirectoryStatus,
} from "../../src/backup-directory";
import { mergeBackup } from "../../src/backup";
import { LOG_PREFIX } from "../../src/config";
import { formatDueRelative } from "../../src/fsrs";
import { sendToBackground } from "../../src/messaging";
import { dueCards } from "../../src/review";
import { DEFAULT_SETTINGS, getAllData } from "../../src/storage";
import type { Settings } from "../../src/types";

const app = document.querySelector<HTMLElement>("#app");
let saving = false;
let backupFeedback: string | null = null;

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: "documents";
  }) => Promise<FileSystemDirectoryHandle>;
};

type NumericSettingKey = "reviewCooldownHours" | "requestRetention" | "maximumIntervalDays";

interface NumericField {
  key: NumericSettingKey;
  name: string;
  help: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
}

const FIELDS: NumericField[] = [
  {
    key: "reviewCooldownHours",
    name: "Fenêtre anti-doublon",
    help: "Un nouvel Accepted sur le même problème dans cet intervalle n'ouvre pas le panneau.",
    min: 0,
    max: 72,
    step: 1,
    suffix: "h",
  },
  {
    key: "requestRetention",
    name: "Rétention visée",
    help: "Probabilité de rappel ciblée par FSRS. Plus haut, révisions plus fréquentes.",
    min: 0.7,
    max: 0.98,
    step: 0.01,
  },
  {
    key: "maximumIntervalDays",
    name: "Intervalle maximum",
    help: "Plafond de la prochaine échéance. Approximatif : l'écart imposé entre les grades peut le dépasser de quelques jours.",
    min: 1,
    max: 3650,
    step: 1,
    suffix: "j",
  },
];

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function fieldHtml(field: NumericField, settings: Settings): string {
  return `
    <div class="field">
      <div class="field-copy">
        <div class="field-name">${esc(field.name)}${field.suffix ? ` (${esc(field.suffix)})` : ""}</div>
        <div class="field-help">${esc(field.help)}</div>
      </div>
      <input
        type="number"
        data-setting="${esc(field.key)}"
        value="${settings[field.key]}"
        min="${field.min}"
        max="${field.max}"
        step="${field.step}"
      />
    </div>
  `;
}

async function render(): Promise<void> {
  if (!app) return;
  const [data, backupStatus] = await Promise.all([
    getAllData(),
    getBackupDirectoryStatus().catch((): BackupDirectoryStatus => ({ state: "missing" })),
  ]);
  const { settings } = data;
  const cards = Object.values(data.cards);
  const now = Date.now();
  const dueCount = dueCards(data.cards, now).length;
  const nextDue = cards
    .filter((card) => new Date(card.fsrs.due).getTime() > now)
    .sort((a, b) => a.fsrs.due.localeCompare(b.fsrs.due))[0];
  const snoozed =
    settings.bannerSnoozedUntil !== null &&
    new Date(settings.bannerSnoozedUntil).getTime() > now;
  const directoryName = backupStatus.state === "missing"
    ? settings.automaticBackupDirectoryName
    : backupStatus.directoryName;
  const automaticActive = settings.automaticBackupEnabled && backupStatus.state === "granted";
  const backupStateLabel = automaticActive
    ? "Sauvegarde automatique active"
    : backupStatus.state === "prompt" || backupStatus.state === "denied"
      ? "Autorisation du dossier à réactiver"
      : settings.automaticBackupEnabled && directoryName !== null
        ? "Dossier à sélectionner de nouveau"
        : directoryName === null
          ? "Aucun dossier sélectionné"
          : "Sauvegarde automatique désactivée";
  const lastBackup = settings.automaticBackupLastAt === null
    ? "Jamais"
    : new Date(settings.automaticBackupLastAt).toLocaleString("fr-FR");

  app.innerHTML = `
    <div class="panel">
      <h2>Planification</h2>
      <p>Ces réglages s'appliquent au prochain calcul d'échéance ; les cartes existantes ne sont pas recalculées.</p>
      ${FIELDS.map((field) => fieldHtml(field, settings)).join("")}
      <div class="field">
        <div class="field-copy">
          <div class="field-name">« À l'arraché » compte comme un échec</div>
          <div class="field-help">
            Décoché, un ressenti 4 donne le grade Hard. Coché, il donne Again : le problème
            revient dès demain.
          </div>
        </div>
        <input type="checkbox" data-setting="arracheCountsAsAgain" ${
          settings.arracheCountsAsAgain ? "checked" : ""
        } />
      </div>
      <div class="actions">
        <button class="primary" data-save>Enregistrer</button>
        <button data-reset>Valeurs par défaut</button>
        <span class="saved-note" data-note hidden>Enregistré ✓</span>
      </div>
      <p class="error" data-error hidden></p>
    </div>

    <div class="panel" id="sauvegardes">
      <h2>Sauvegardes</h2>
      <p>
        Les données sont déjà conservées localement par Chrome, pas dans des cookies. Choisis un
        dossier pour qu'une copie de <code>${BACKUP_FILENAME}</code> soit mise à jour après chaque
        révision.
      </p>
      <div class="backup-status ${automaticActive ? "active" : ""}">
        <span class="status-dot"></span>
        <div>
          <div class="field-name">${esc(backupStateLabel)}</div>
          <div class="field-help">
            Dossier : ${directoryName === null ? "—" : `<b>${esc(directoryName)}</b>`}
            · Dernière copie : ${esc(lastBackup)}
          </div>
        </div>
      </div>
      ${
        settings.automaticBackupLastError === null
          ? ""
          : `<p class="error backup-message">${esc(settings.automaticBackupLastError)}</p>`
      }
      ${backupFeedback === null ? "" : `<p class="success backup-message">${esc(backupFeedback)}</p>`}
      <div class="actions wrap">
        <button class="primary" data-choose-backup-folder>Choisir un dossier</button>
        ${
          backupStatus.state === "prompt" || backupStatus.state === "denied"
            ? `<button data-reauthorize-backup>Réautoriser</button>`
            : directoryName !== null
              ? `<button data-backup-now>Sauvegarder maintenant</button>`
              : ""
        }
        ${
          settings.automaticBackupEnabled
            ? `<button data-disable-backup>Désactiver l'auto</button>`
            : backupStatus.state === "granted"
              ? `<button data-enable-backup>Activer l'auto</button>`
              : ""
        }
        ${directoryName !== null ? `<button data-forget-backup>Oublier le dossier</button>` : ""}
      </div>
      <div class="data-actions">
        <div>
          <div class="field-name">Importer ou exporter manuellement</div>
          <div class="field-help">L'import fusionne les cartes et l'historique sans effacer les données présentes.</div>
        </div>
        <div class="actions compact">
          <button data-import>Importer un JSON</button>
          <button data-export>Exporter un JSON</button>
          <input type="file" accept="application/json,.json" data-import-file hidden />
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>État</h2>
      <dl>
        <div><dt>Cartes suivies</dt><dd>${cards.length}</dd></div>
        <div><dt>Dues maintenant</dt><dd>${dueCount}</dd></div>
        <div><dt>Révisions loguées</dt><dd>${data.log.length}</dd></div>
      </dl>
      <p style="margin-top:14px">
        Prochaine échéance : ${
          nextDue === undefined
            ? "aucune"
            : `<b>${esc(nextDue.title)}</b> · ${esc(formatDueRelative(nextDue.fsrs.due))}`
        }
      </p>
      ${
        snoozed
          ? `<div class="actions"><button data-unsnooze>Réafficher le bandeau sur LeetCode et NeetCode</button></div>`
          : ""
      }
    </div>

    <dialog class="backup-dialog" data-existing-backup-dialog>
      <form method="dialog">
        <div class="eyebrow">SAUVEGARDE DÉTECTÉE</div>
        <h2>Un fichier existe déjà</h2>
        <p data-existing-backup-copy></p>
        <div class="dialog-actions">
          <button class="primary" value="import">Oui, importer</button>
          <button value="replace">Non, remplacer</button>
          <button class="quiet" value="cancel">Annuler</button>
        </div>
      </form>
    </dialog>
  `;

  wire(settings);
}

function readForm(settings: Settings): Settings {
  if (!app) return settings;
  const next = { ...settings };
  for (const field of FIELDS) {
    const input = app.querySelector<HTMLInputElement>(`[data-setting="${field.key}"]`);
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value < field.min || value > field.max) {
      throw new Error(`${field.name} : valeur attendue entre ${field.min} et ${field.max}.`);
    }
    next[field.key] = value;
  }
  next.arracheCountsAsAgain =
    app.querySelector<HTMLInputElement>('[data-setting="arracheCountsAsAgain"]')?.checked ?? false;
  return next;
}

function askExistingBackupAction(directoryName: string): Promise<"import" | "replace" | "cancel"> {
  const dialog = app?.querySelector<HTMLDialogElement>("[data-existing-backup-dialog]");
  const copy = dialog?.querySelector<HTMLElement>("[data-existing-backup-copy]");
  if (dialog === undefined || dialog === null || copy === undefined || copy === null) {
    return Promise.resolve("cancel");
  }
  copy.textContent = `${BACKUP_FILENAME} existe déjà dans « ${directoryName} ». Veux-tu importer et fusionner son contenu avec les données actuelles ?`;
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "import" || dialog.returnValue === "replace"
        ? dialog.returnValue
        : "cancel");
    }, { once: true });
    dialog.showModal();
  });
}

function wire(settings: Settings): void {
  if (!app) return;
  const error = app.querySelector<HTMLElement>("[data-error]");

  function fail(message: string): void {
    if (!error) return;
    error.hidden = false;
    error.textContent = message;
  }

  function failFrom(err: unknown): void {
    fail(err instanceof Error ? err.message : String(err));
  }

  async function save(next: Settings): Promise<void> {
    if (error) error.hidden = true;
    // L'écriture déclenche storage.onChanged, donc un re-rendu : `saving` évite
    // qu'il n'efface la confirmation affichée juste après.
    saving = true;
    try {
      await sendToBackground({ kind: "SAVE_SETTINGS", settings: next });
      await render();
    } finally {
      saving = false;
    }
    const note = app?.querySelector<HTMLElement>("[data-note]");
    if (!note) return;
    note.hidden = false;
    window.setTimeout(() => {
      note.hidden = true;
    }, 1_600);
  }

  app.querySelector<HTMLButtonElement>("[data-save]")?.addEventListener("click", () => {
    let next: Settings;
    try {
      next = readForm(settings);
    } catch (err) {
      failFrom(err);
      return;
    }
    save(next).catch(failFrom);
  });

  app.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => {
    save({
      ...DEFAULT_SETTINGS,
      bannerSnoozedUntil: settings.bannerSnoozedUntil,
      automaticBackupEnabled: settings.automaticBackupEnabled,
      automaticBackupDirectoryName: settings.automaticBackupDirectoryName,
      automaticBackupLastAt: settings.automaticBackupLastAt,
      automaticBackupLastError: settings.automaticBackupLastError,
    }).catch(failFrom);
  });

  app.querySelector<HTMLButtonElement>("[data-unsnooze]")?.addEventListener("click", () => {
    save({ ...settings, bannerSnoozedUntil: null }).catch(failFrom);
  });

  async function runBackupAction(action: () => Promise<string | null>): Promise<void> {
    saving = true;
    backupFeedback = null;
    try {
      backupFeedback = await action();
      await render();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) failFrom(err);
    } finally {
      saving = false;
    }
  }

  app.querySelector<HTMLButtonElement>("[data-choose-backup-folder]")?.addEventListener("click", () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (picker === undefined) {
      fail("Cette version de Chrome ne prend pas en charge le choix de dossier.");
      return;
    }
    void runBackupAction(async () => {
      const handle = await picker.call(window, {
        id: "companion-automatic-backup",
        mode: "readwrite",
        startIn: "documents",
      });
      const existingBackup = await readExistingBackup(handle);
      const action = existingBackup === null
        ? "replace"
        : await askExistingBackupAction(handle.name);
      if (action === "cancel") return null;

      let importData: unknown = null;
      if (action === "import" && existingBackup !== null) {
        importData = JSON.parse(existingBackup) as unknown;
        // Valide intégralement avant de mémoriser le dossier ou de toucher au fichier existant.
        mergeBackup(importData, await getAllData());
      }

      await saveBackupDirectoryHandle(handle);
      await sendToBackground({
        kind: "SAVE_SETTINGS",
        settings: {
          automaticBackupEnabled: true,
          automaticBackupDirectoryName: handle.name,
          automaticBackupLastError: null,
        },
      });
      if (action === "import") {
        const summary = await sendToBackground({ kind: "IMPORT_BACKUP", data: importData });
        return `Sauvegarde importée et activée dans « ${handle.name} » : ${summary.cardsAdded} carte(s) ajoutée(s), ${summary.cardsUpdated} fusionnée(s).`;
      }
      await sendToBackground({ kind: "WRITE_BACKUP_NOW" });
      return existingBackup === null
        ? `Sauvegarde activée dans « ${handle.name} ».`
        : `${BACKUP_FILENAME} a été remplacé dans « ${handle.name} ».`;
    });
  });

  async function authorizeAndWrite(enableAutomatic: boolean): Promise<string> {
    const status = await requestBackupDirectoryPermission();
    if (status.state !== "granted") throw new Error("Chrome n'a pas autorisé ce dossier.");
    await sendToBackground({
      kind: "SAVE_SETTINGS",
      settings: {
        automaticBackupEnabled: enableAutomatic,
        automaticBackupDirectoryName: status.directoryName,
        automaticBackupLastError: null,
      },
    });
    await sendToBackground({ kind: "WRITE_BACKUP_NOW" });
    return `${BACKUP_FILENAME} a été mis à jour.`;
  }

  app.querySelector<HTMLButtonElement>("[data-reauthorize-backup]")?.addEventListener("click", () => {
    void runBackupAction(() => authorizeAndWrite(settings.automaticBackupEnabled));
  });
  app.querySelector<HTMLButtonElement>("[data-backup-now]")?.addEventListener("click", () => {
    void runBackupAction(() => authorizeAndWrite(settings.automaticBackupEnabled));
  });
  app.querySelector<HTMLButtonElement>("[data-enable-backup]")?.addEventListener("click", () => {
    void runBackupAction(() => authorizeAndWrite(true));
  });
  app.querySelector<HTMLButtonElement>("[data-disable-backup]")?.addEventListener("click", () => {
    void runBackupAction(async () => {
      await sendToBackground({
        kind: "SAVE_SETTINGS",
        settings: { automaticBackupEnabled: false },
      });
      return "Sauvegarde automatique désactivée ; le dossier reste mémorisé.";
    });
  });
  app.querySelector<HTMLButtonElement>("[data-forget-backup]")?.addEventListener("click", () => {
    void runBackupAction(async () => {
      await forgetBackupDirectoryHandle();
      await sendToBackground({
        kind: "SAVE_SETTINGS",
        settings: {
          automaticBackupEnabled: false,
          automaticBackupDirectoryName: null,
          automaticBackupLastError: null,
        },
      });
      return "Le dossier a été oublié. Le fichier déjà créé n'a pas été supprimé.";
    });
  });

  app.querySelector<HTMLButtonElement>("[data-export]")?.addEventListener("click", () => {
    void exportJson().catch(failFrom);
  });
  const fileInput = app.querySelector<HTMLInputElement>("[data-import-file]");
  app.querySelector<HTMLButtonElement>("[data-import]")?.addEventListener("click", () => {
    fileInput?.click();
  });
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file === undefined) return;
    void runBackupAction(async () => {
      const data = JSON.parse(await file.text()) as unknown;
      const summary = await sendToBackground({ kind: "IMPORT_BACKUP", data });
      return `Import terminé : ${summary.cardsAdded} carte(s) ajoutée(s), ${summary.cardsUpdated} fusionnée(s), ${summary.logEntriesAdded} révision(s) ajoutée(s).`;
    });
  });
}

async function exportJson(): Promise<void> {
  const data = await getAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `companion-export-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

browser.storage.onChanged.addListener(() => {
  if (saving) return; // le rendu est piloté par save()
  // Le formulaire n'est ré-rendu que si l'utilisateur n'est pas en train de saisir.
  if (document.activeElement?.tagName === "INPUT") return;
  void render().catch((err: unknown) => console.warn(`${LOG_PREFIX} options`, err));
});

void render().catch((err: unknown) => console.warn(`${LOG_PREFIX} options`, err));
