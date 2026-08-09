// Réglages FSRS. Lecture directe du storage, écriture via le background.

import { browser } from "wxt/browser";
import { LOG_PREFIX } from "../../src/config";
import { formatDueRelative } from "../../src/fsrs";
import { sendToBackground } from "../../src/messaging";
import { dueCards } from "../../src/review";
import { DEFAULT_SETTINGS, getAllData } from "../../src/storage";
import type { Settings } from "../../src/types";

const app = document.querySelector<HTMLElement>("#app");
let saving = false;

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
  const data = await getAllData();
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
          ? `<div class="actions"><button data-unsnooze>Réafficher le bandeau sur neetcode.io</button></div>`
          : ""
      }
    </div>
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
    save({ ...DEFAULT_SETTINGS, bannerSnoozedUntil: settings.bannerSnoozedUntil }).catch(failFrom);
  });

  app.querySelector<HTMLButtonElement>("[data-unsnooze]")?.addEventListener("click", () => {
    save({ ...settings, bannerSnoozedUntil: null }).catch(failFrom);
  });
}

browser.storage.onChanged.addListener(() => {
  if (saving) return; // le rendu est piloté par save()
  // Le formulaire n'est ré-rendu que si l'utilisateur n'est pas en train de saisir.
  if (document.activeElement?.tagName === "INPUT") return;
  void render().catch((err: unknown) => console.warn(`${LOG_PREFIX} options`, err));
});

void render().catch((err: unknown) => console.warn(`${LOG_PREFIX} options`, err));
