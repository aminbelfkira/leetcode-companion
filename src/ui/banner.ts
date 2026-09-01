// Bandeau commun LeetCode / NeetCode, injecté quand des révisions sont dues.

export interface BannerInfo {
  count: number;
  next: { id: string; title: string };
}

export interface BannerCallbacks {
  /** « Ouvrir » — navigue vers le dû le plus ancien. */
  onOpen(problemId: string): void;
  /** « Plus tard » ou « × » — snooze jusqu'au prochain minuit local. */
  onSnooze(): void;
}

const HOST_ID = "lcfsrs-banner-host";

const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.banner {
  position: fixed; top: 0; left: 0; right: 0;
  z-index: 2147483646;
  display: flex; align-items: center; gap: 10px;
  padding: 5px 12px;
  background: rgba(255, 161, 22, .14);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 161, 22, .4);
  color: #eff1f3;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px; line-height: 1.3;
  animation: lcfsrs-slide .18s ease-out;
}
@keyframes lcfsrs-slide {
  from { transform: translateY(-100%); }
  to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .banner { animation: none; }
}
.txt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.txt b { font-weight: 650; }
button {
  font: inherit; cursor: pointer;
  background: none; border: 1px solid rgba(255, 161, 22, .5);
  border-radius: 6px; color: #ffa116;
  padding: 2px 8px; font-size: 11px;
  white-space: nowrap;
}
button:hover { background: rgba(255, 161, 22, .15); }
.close { border: none; font-size: 14px; color: #8f959c; padding: 2px 6px; }
.close:hover { color: #eff1f3; background: none; }
`;

let host: HTMLDivElement | null = null;
let txtEl: HTMLElement | null = null;
let callbacks: BannerCallbacks | null = null;
let currentProblemId = "";

export function renderBanner(info: BannerInfo, cb: BannerCallbacks): void {
  callbacks = cb;
  currentProblemId = info.next.id;

  if (host === null) {
    host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);

    const banner = document.createElement("div");
    banner.className = "banner";
    banner.innerHTML = `
      <span class="txt"></span>
      <button class="open">Ouvrir</button>
      <button class="later">Plus tard</button>
      <button class="close" title="Plus tard">×</button>
    `;
    shadow.appendChild(banner);

    txtEl = banner.querySelector<HTMLElement>(".txt");
    banner.querySelector(".open")?.addEventListener("click", () => {
      callbacks?.onOpen(currentProblemId);
    });
    const snooze = (): void => callbacks?.onSnooze();
    banner.querySelector(".later")?.addEventListener("click", snooze);
    banner.querySelector(".close")?.addEventListener("click", snooze);

    (document.body ?? document.documentElement).appendChild(host);
  }

  if (txtEl !== null) {
    txtEl.textContent = "";
    txtEl.append(
      `↻ ${info.count} révision${info.count > 1 ? "s" : ""} due${info.count > 1 ? "s" : ""} · prochaine : `,
    );
    const b = document.createElement("b");
    b.textContent = info.next.title;
    txtEl.appendChild(b);
  }
}

export function removeBanner(): void {
  host?.remove();
  host = null;
  txtEl = null;
  callbacks = null;
}
