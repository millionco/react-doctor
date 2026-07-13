// rule: client-passive-event-listeners
// weakness: cancellation-alias
// source: ISSUES_TO_FIX_ASAP.md Web API receiver adversarial review
const cancelEvent = (event: Event) => event["preventDefault"]();
const target = new EventTarget();

target.addEventListener("wheel", (event) => cancelEvent(event));
