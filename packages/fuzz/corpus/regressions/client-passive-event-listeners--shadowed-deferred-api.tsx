// rule: client-passive-event-listeners
// weakness: global-provenance
// source: ISSUES_TO_FIX_ASAP.md Web API receiver adversarial review
const setTimeout = (callback: () => void) => callback();
const target = new EventTarget();

target.addEventListener("wheel", (event) => setTimeout(() => onMove(event)));
