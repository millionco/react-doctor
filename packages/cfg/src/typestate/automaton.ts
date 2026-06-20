// A finite-state protocol a resource must obey (opened→closed, locked→
// unlocked, …), verified over the CFG by `verifyTypestate`. States and
// events are opaque strings the driving rule defines; the engine only
// transitions between them and checks the two failure modes:
//   - reaching an `errorState` (an illegal event for the current state —
//     double-close, use-after-free);
//   - a resource resting in a non-`acceptingState` at normal completion (a
//     leak — opened but never closed).
export interface TypestateAutomaton {
  readonly initial: string;
  // The state after `event` fires in `state`. Return an error state for an
  // illegal transition; return `state` unchanged to ignore an event.
  readonly transition: (state: string, event: string) => string;
  readonly errorStates: ReadonlySet<string>;
  // States it is safe to end in on a normal-completion path (typically the
  // initial state — resource never acquired — plus the released state).
  readonly acceptingStates: ReadonlySet<string>;
}
