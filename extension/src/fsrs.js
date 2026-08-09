// Wrapper ts-fsrs : mapping (mode, ressenti) → grade, scheduling, sérialisation.
// Nécessite vendor/ts-fsrs.umd.js chargé avant (global `FSRS`) : background seul.

self.NCC = self.NCC || {};

(() => {
  const NCC = self.NCC;
  const lib = self.FSRS;

  function scheduler(settings) {
    return lib.fsrs(
      lib.generatorParameters({
        request_retention: settings.requestRetention,
        maximum_interval: settings.maximumIntervalDays,
        enable_fuzz: true,
        // « Again → prochaine révision : demain » : les steps courts
        // (1 min / 10 min) des flashcards n'ont pas de sens pour des problèmes
        // d'algo, on planifie toujours à la journée.
        enable_short_term: false,
      }),
    );
  }

  /** Mapping (mode, ressenti) → grade FSRS (1 Again · 2 Hard · 3 Good · 4 Easy). */
  NCC.gradeFor = function gradeFor(mode, feel, settings) {
    if (mode === "aide" || mode === "abandon") return 1;
    switch (feel) {
      case 4:
        return settings.arracheCountsAsAgain ? 1 : 2;
      case 3:
        return 2;
      case 2:
        return 3;
      case 1:
        return 4;
      default:
        throw new Error("mode 'seul' sans ressenti");
    }
  };

  function toCard(state) {
    const lastReview = state.last_review === null ? undefined : new Date(state.last_review);
    const due = new Date(state.due);
    const scheduledDays =
      lastReview !== undefined
        ? Math.max(0, Math.round((due.getTime() - lastReview.getTime()) / NCC.DAY_MS))
        : 0;
    return {
      due,
      stability: state.stability,
      difficulty: state.difficulty,
      elapsed_days: 0, // déprécié côté ts-fsrs, recalculé depuis last_review
      scheduled_days: scheduledDays,
      learning_steps: 0, // steps courts désactivés (enable_short_term: false)
      reps: state.reps,
      lapses: state.lapses,
      state: state.state,
      ...(lastReview !== undefined ? { last_review: lastReview } : {}),
    };
  }

  function fromCard(card) {
    return {
      due: card.due.toISOString(),
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.last_review instanceof Date ? card.last_review.toISOString() : null,
    };
  }

  /** Applique une review. `prev = null` pour une première carte. */
  NCC.nextState = function nextState(prev, grade, now, settings) {
    const f = scheduler(settings);
    const card = prev === null ? lib.createEmptyCard(now) : toCard(prev);
    const { card: next } = f.next(card, now, grade);
    return fromCard(next);
  };
})();
