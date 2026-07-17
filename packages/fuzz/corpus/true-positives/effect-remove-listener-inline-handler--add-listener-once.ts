// rule: effect-remove-listener-inline-handler
// weakness: registration-method-coverage
// source: Cursor Bugbot review of PR #1365

interface EventEmitter {
  addListener: (eventName: string, handler: () => void) => void;
  once: (eventName: string, handler: () => void) => void;
  off: (eventName: string, handler: () => void) => void;
}

export const registerListeners = (emitter: EventEmitter): void => {
  emitter.addListener("change", handleChange);
  emitter.off("change", () => handleChange());
  emitter.once("close", handleClose);
  emitter.off("close", () => handleClose());
};

declare const handleChange: () => void;
declare const handleClose: () => void;
