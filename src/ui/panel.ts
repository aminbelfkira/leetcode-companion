// Panneau de notation injecté après un Accepted. Shadow DOM, styles
// auto-contenus, aucune fuite CSS vers ou depuis NeetCode.

import { formatDueRelative } from "../fsrs";
import type { Feel } from "../types";

export type PanelMode = "seul" | "aide";

export interface PanelData {
  title: string;
  ncDifficulty: string;
  submissionsInSession: number;
  minutesInSession: number | null;
}

export interface PanelCallbacks {
  /** Due ISO prévisionnelle pour la sélection courante, null si indisponible. */
  previewDue(mode: PanelMode, feel: Feel): Promise<string | null>;
  /** Enregistre la review, renvoie la due ISO ou null en cas d'échec. */
  onSave(mode: PanelMode, feel: Feel): Promise<string | null>;
  /** Fermé (croix, Échap, clic extérieur) sans enregistrer. */
  onDismiss(): void;
}

const HOST_ID = "nccfsrs-panel-host";

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.panel {
  --card:#1a1b1d; --card2:#242528; --line:#2f3134;
  --ink:#eff1f3; --mut:#8f959c; --nc:#48c78e;
  --medium:#ffc01e; --hard:#f63737;
  position: fixed; right: 16px; bottom: 16px; width: 308px;
  z-index: 2147483647;
  background: var(--card); color: var(--ink);
  border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.45);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px; line-height: 1.4;
  padding: 14px;
  animation: nccfsrs-in .18s ease-out;
}
@keyframes nccfsrs-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
}
.tag { color: var(--nc); font-size: 11px; font-weight: 600; letter-spacing: .02em; }
.close {
  position: absolute; top: 8px; right: 10px;
  background: none; border: none; color: var(--mut);
  font-size: 16px; cursor: pointer; padding: 2px 6px;
}
.close:hover { color: var(--ink); }
.title {
  font-weight: 650; font-size: 14px; margin-top: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chips { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.chip {
  background: var(--card2); border: 1px solid var(--line); border-radius: 999px;
  padding: 2px 8px; font-size: 11px; color: var(--mut);
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
.chip.easy { color: var(--nc); }
.chip.medium { color: var(--medium); }
.chip.hard { color: var(--hard); }
.q { color: var(--mut); font-size: 11px; margin: 12px 0 6px; }
.row { display: flex; gap: 6px; }
.opt {
  flex: 1; background: var(--card2); border: 1px solid var(--line);
  border-radius: 8px; color: var(--ink); padding: 7px 4px;
  font-size: 12px; cursor: pointer; text-align: center;
}
.opt:hover { border-color: var(--mut); }
.opt.sel { border-color: var(--nc); color: var(--nc); }
.opt small { display: block; color: var(--mut); font-size: 10px; }
.opt.sel small { color: var(--nc); }
.next { margin-top: 12px; font-size: 12px; color: var(--mut); min-height: 16px; }
.next b { color: var(--ink); font-weight: 600; }
.save {
  width: 100%; margin-top: 10px; padding: 8px;
  background: var(--nc); border: none; border-radius: 8px;
  color: #ffffff; font-weight: 650; font-size: 13px; cursor: pointer;
}
.save:disabled { opacity: .4; cursor: default; }
.hint { margin-top: 8px; font-size: 10px; color: var(--mut); text-align: center; }
.saved { color: var(--nc); font-weight: 650; text-align: center; padding: 24px 0; }
`;

let mounted = false;

export function isPanelMounted(): boolean {
  return mounted;
}

export function mountPanel(data: PanelData, cb: PanelCallbacks): void {
  if (mounted) return; // une seule instance
  mounted = true;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "panel";
  shadow.appendChild(panel);

  const diffClass = data.ncDifficulty.toLowerCase();
  const minutesChip =
    data.minutesInSession === null
      ? ""
      : `<span class="chip">≈ ${data.minutesInSession} min</span>`;

  panel.innerHTML = `
    <div class="tag">✓ Accepted · détecté</div>
    <button class="close" title="Fermer">×</button>
    <div class="title"></div>
    <div class="chips">
      <span class="chip ${diffClass}">${escapeHtml(data.ncDifficulty)}</span>
      <span class="chip">${data.submissionsInSession} soumission${data.submissionsInSession > 1 ? "s" : ""}</span>
      ${minutesChip}
    </div>
    <div class="q">Résolu comment ?</div>
    <div class="row" data-group="mode">
      <button class="opt" data-mode="seul">Seul</button>
      <button class="opt" data-mode="aide">Avec aide<small>IA · YouTube · solution</small></button>
    </div>
    <div class="q">Difficulté ressentie</div>
    <div class="row" data-group="feel">
      <button class="opt" data-feel="1">1<small>fluide</small></button>
      <button class="opt" data-feel="2">2<small>correct</small></button>
      <button class="opt" data-feel="3">3<small>laborieux</small></button>
      <button class="opt" data-feel="4">4<small>à l'arraché</small></button>
    </div>
    <div class="next">Prochaine révision : <b>—</b></div>
    <button class="save" disabled>Enregistrer la révision</button>
    <div class="hint">Intervalle indicatif</div>
  `;
  const titleEl = panel.querySelector<HTMLDivElement>(".title");
  if (titleEl) titleEl.textContent = data.title;

  let mode: PanelMode | null = null;
  let feel: Feel | null = null;
  let closed = false;

  const nextEl = panel.querySelector<HTMLElement>(".next b");
  const nextLine = panel.querySelector<HTMLElement>(".next");
  const saveBtn = panel.querySelector<HTMLButtonElement>(".save");

  function detachListeners(): void {
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("mousedown", onOutsideClick, true);
  }

  function remove(): void {
    if (closed) return;
    closed = true;
    mounted = false;
    detachListeners();
    host.remove();
  }

  function dismiss(): void {
    if (closed) return;
    cb.onDismiss();
    remove();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") dismiss();
  }

  function onOutsideClick(e: MouseEvent): void {
    if (!e.composedPath().includes(host)) dismiss();
  }

  async function refreshPreview(): Promise<void> {
    if (mode === null || feel === null || nextEl === null || saveBtn === null) return;
    saveBtn.disabled = false;
    const selMode = mode;
    const selFeel = feel;
    try {
      const due = await cb.previewDue(selMode, selFeel);
      // La sélection a pu changer pendant l'await
      if (mode !== selMode || feel !== selFeel || closed) return;
      nextEl.textContent = due === null ? "—" : formatDueRelative(due);
    } catch {
      nextEl.textContent = "—";
    }
  }

  function selectIn(group: "mode" | "feel", chosen: HTMLElement): void {
    panel
      .querySelectorAll(`[data-group="${group}"] .opt`)
      .forEach((el) => el.classList.toggle("sel", el === chosen));
  }

  panel.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target.closest("button") : null;
    if (!target) return;
    if (target.classList.contains("close")) {
      dismiss();
      return;
    }
    const modeAttr = target.getAttribute("data-mode");
    if (modeAttr === "seul" || modeAttr === "aide") {
      mode = modeAttr;
      selectIn("mode", target);
      void refreshPreview();
      return;
    }
    const feelAttr = target.getAttribute("data-feel");
    if (feelAttr !== null) {
      feel = Number(feelAttr) as Feel;
      selectIn("feel", target);
      void refreshPreview();
      return;
    }
    if (target.classList.contains("save") && mode !== null && feel !== null) {
      const selMode = mode;
      const selFeel = feel;
      target.disabled = true;
      void cb.onSave(selMode, selFeel).then((due) => {
        if (closed) return;
        if (due === null) {
          target.disabled = false;
          if (nextLine) nextLine.textContent = "Erreur, réessayer";
          return;
        }
        closed = true; // plus de dismiss possible
        mounted = false;
        panel.innerHTML = `<div class="saved">Enregistré ✓</div>`;
        window.setTimeout(() => host.remove(), 1_200);
        detachListeners();
      });
    }
  });

  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("mousedown", onOutsideClick, true);
  (document.body ?? document.documentElement).appendChild(host);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
