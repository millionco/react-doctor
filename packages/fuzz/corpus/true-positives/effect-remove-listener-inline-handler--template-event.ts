// rule: effect-remove-listener-inline-handler
// weakness: library-idiom
// source: PR #1365 Bugbot 3603065901

emitter.on(`change`, handleChange);
emitter.off(`change`, () => handleChange());
