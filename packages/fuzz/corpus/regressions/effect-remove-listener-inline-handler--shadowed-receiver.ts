// rule: effect-remove-listener-inline-handler
// weakness: alias-guard
// source: PR #1365 deep audit

export const register = (emitter: EventEmitter) => {
  emitter.on("change", handleChange);
};

export const cleanup = (emitter: EventEmitter) => {
  emitter.off("change", () => handleChange());
};
