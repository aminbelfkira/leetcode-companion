import { describe, expect, it } from "vitest";
import { daysUntil, formatDueRelative, gradeFor, nextState } from "../src/fsrs";
import { DEFAULT_SETTINGS } from "../src/storage";
import type { Settings } from "../src/types";

const settings: Settings = DEFAULT_SETTINGS;
const now = new Date("2026-08-09T12:00:00.000Z");

describe("gradeFor", () => {
  it("traite l'aide et l'abandon comme un échec", () => {
    expect(gradeFor("aide", 1, settings)).toBe(1);
    expect(gradeFor("abandon", null, settings)).toBe(1);
  });

  it("mappe le ressenti sur les grades quand le problème est résolu seul", () => {
    expect(gradeFor("seul", 1, settings)).toBe(4); // fluide → Easy
    expect(gradeFor("seul", 2, settings)).toBe(3); // correct → Good
    expect(gradeFor("seul", 3, settings)).toBe(2); // laborieux → Hard
    expect(gradeFor("seul", 4, settings)).toBe(2); // à l'arraché → Hard
  });

  it("durcit le ressenti 4 quand le réglage le demande", () => {
    expect(gradeFor("seul", 4, { ...settings, arracheCountsAsAgain: true })).toBe(1);
  });

  it("refuse un mode « seul » sans ressenti", () => {
    expect(() => gradeFor("seul", null, settings)).toThrow();
  });
});

describe("nextState", () => {
  it("planifie une première carte au-delà de la journée en cours", () => {
    const state = nextState(null, 3, now, settings);
    expect(new Date(state.due).getTime()).toBeGreaterThan(now.getTime());
    expect(state.reps).toBe(1);
    expect(state.last_review).toBe(now.toISOString());
  });

  it("classe les grades du plus court au plus long intervalle", () => {
    const dueFor = (grade: 1 | 2 | 3 | 4) =>
      new Date(nextState(null, grade, now, settings).due).getTime();
    expect(dueFor(1)).toBeLessThan(dueFor(2));
    expect(dueFor(2)).toBeLessThanOrEqual(dueFor(3));
    expect(dueFor(3)).toBeLessThanOrEqual(dueFor(4));
  });

  it("renvoie « Again » à demain plutôt qu'aux quelques minutes des flashcards", () => {
    // enable_short_term: false, donc pas de pas d'apprentissage en minutes.
    const state = nextState(null, 1, now, settings);
    const hours = (new Date(state.due).getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(1);
  });

  it("compte une rechute quand une carte connue repasse en échec", () => {
    const first = nextState(null, 3, now, settings);
    const later = new Date(new Date(first.due).getTime() + 3_600_000);
    const second = nextState(first, 1, later, settings);
    expect(second.reps).toBe(2);
    expect(second.lapses).toBe(1);
  });

  /** Intervalle du dernier passage après `rounds` révisions du même grade. */
  function intervalAfterRounds(maximumIntervalDays: number, rounds: number): number {
    const tuned: Settings = { ...settings, maximumIntervalDays };
    let state = nextState(null, 4, now, tuned);
    let clock = now;
    for (let i = 0; i < rounds; i++) {
      clock = new Date(state.due);
      state = nextState(state, 4, clock, tuned);
    }
    return daysUntil(state.due, clock);
  }

  it("respecte le plafond, à la marge de séparation des grades près", () => {
    // Le scheduler long terme applique maximum_interval sur chaque grade, puis
    // rétablit Again < Hard < Good < Easy : Easy peut donc dépasser le plafond
    // de trois jours. Négligeable au réglage par défaut (180 jours).
    const cap = 10;
    for (let rounds = 1; rounds <= 8; rounds++) {
      expect(intervalAfterRounds(cap, rounds)).toBeLessThanOrEqual(cap + 3);
    }
  });

  it("raccourcit réellement les intervalles quand le plafond baisse", () => {
    expect(intervalAfterRounds(10, 8)).toBeLessThan(intervalAfterRounds(3650, 8));
  });
});

describe("formatDueRelative", () => {
  it("nomme aujourd'hui, demain et les jours suivants", () => {
    expect(formatDueRelative("2026-08-09T08:00:00.000Z", now)).toBe("aujourd'hui");
    expect(formatDueRelative("2026-08-10T11:00:00.000Z", now)).toBe("demain");
    expect(formatDueRelative("2026-08-13T11:00:00.000Z", now)).toBe("dans 4 j");
  });
});
