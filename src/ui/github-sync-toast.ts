export interface GithubSyncToastData {
  repository: string;
  path: string;
}

export interface GithubSyncToastCallbacks {
  onOpen?(): void;
}

const HOST_ID = "lcfsrs-github-toast-host";
const AUTO_DISMISS_MS = 6_000;

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.toast {
  --card:#1a1b1d; --card2:#242528; --line:#2f3134;
  --ink:#eff1f3; --mut:#8f959c; --ok:#2cbb5d;
  position: fixed; top: 48px; right: 16px; width: min(356px, calc(100vw - 32px));
  z-index: 2147483647;
  display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto;
  align-items: center; gap: 10px;
  padding: 12px;
  color: var(--ink); background: var(--card);
  border: 1px solid rgba(44,187,93,.45); border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0,0,0,.45);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px; line-height: 1.35;
  animation: lcfsrs-toast-in .2s ease-out;
}
.toast.out { animation: lcfsrs-toast-out .16s ease-in forwards; }
@keyframes lcfsrs-toast-in {
  from { opacity: 0; transform: translateY(-8px) scale(.98); }
  to { opacity: 1; transform: none; }
}
@keyframes lcfsrs-toast-out {
  to { opacity: 0; transform: translateY(-6px) scale(.98); }
}
.icon {
  width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: 50%; color: var(--ok); background: rgba(44,187,93,.14);
  border: 1px solid rgba(44,187,93,.35); font-size: 16px; font-weight: 750;
}
.copy { min-width: 0; }
.tag { color: var(--ok); font-size: 10px; font-weight: 700; letter-spacing: .04em; }
.title { margin-top: 2px; font-size: 13px; font-weight: 650; }
.repo, .path {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--mut); font: 10px ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}
.repo { margin-top: 4px; color: var(--ink); }
.path { margin-top: 1px; }
button {
  font: inherit; cursor: pointer; border-radius: 7px; background: var(--card2);
}
.open {
  padding: 5px 8px; color: var(--ok); border: 1px solid rgba(44,187,93,.4);
  font-size: 11px; white-space: nowrap;
}
.open:hover { background: rgba(44,187,93,.12); }
.close {
  align-self: start; color: var(--mut); background: none; border: none;
  padding: 0 2px; font-size: 16px; line-height: 1;
}
.close:hover { color: var(--ink); }
@media (max-width: 520px) {
  .toast { top: 42px; left: 12px; right: 12px; width: auto; }
  .open { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .toast, .toast.out { animation: none; }
}
`;

let removeActiveToast: (() => void) | null = null;

export function showGithubSyncToast(
  data: GithubSyncToastData,
  callbacks: GithubSyncToastCallbacks = {},
): void {
  removeActiveToast?.();

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  shadow.appendChild(style);

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <div class="icon" aria-hidden="true">✓</div>
    <div class="copy" role="status" aria-live="polite" aria-atomic="true">
      <div class="tag">GITHUB SYNC</div>
      <div class="title">Solution synchronisée</div>
      <div class="repo"></div>
      <div class="path"></div>
    </div>
    <button type="button" class="open">Ouvrir</button>
    <button type="button" class="close" aria-label="Fermer">×</button>
  `;
  shadow.appendChild(toast);

  const repository = toast.querySelector<HTMLElement>(".repo");
  const path = toast.querySelector<HTMLElement>(".path");
  const open = toast.querySelector<HTMLButtonElement>(".open");
  const close = toast.querySelector<HTMLButtonElement>(".close");
  if (repository !== null) {
    repository.textContent = data.repository;
    repository.title = data.repository;
  }
  if (path !== null) {
    path.textContent = data.path;
    path.title = data.path;
  }
  if (callbacks.onOpen === undefined) open?.remove();

  let removed = false;
  let timer: number | null = null;
  const removeImmediately = (): void => remove(true);

  function clearTimer(): void {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }

  function detach(): void {
    host.remove();
    if (removeActiveToast === removeImmediately) removeActiveToast = null;
  }

  function remove(immediate = false): void {
    if (removed) return;
    removed = true;
    clearTimer();
    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      detach();
      return;
    }
    toast.classList.add("out");
    window.setTimeout(detach, 180);
  }

  function scheduleRemoval(): void {
    clearTimer();
    timer = window.setTimeout(remove, AUTO_DISMISS_MS);
  }

  open?.addEventListener("click", () => {
    callbacks.onOpen?.();
    remove();
  });
  close?.addEventListener("click", () => remove());
  toast.addEventListener("mouseenter", clearTimer);
  toast.addEventListener("mouseleave", scheduleRemoval);
  toast.addEventListener("focusin", clearTimer);
  toast.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !toast.contains(next)) scheduleRemoval();
  });

  removeActiveToast = removeImmediately;
  (document.body ?? document.documentElement).appendChild(host);
  scheduleRemoval();
}
