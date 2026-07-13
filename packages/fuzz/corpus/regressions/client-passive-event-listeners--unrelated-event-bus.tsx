// rule: client-passive-event-listeners
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md Web API receiver provenance matrix
interface GestureBus {
  addEventListener(eventName: "wheel", handler: (delta: number) => void, priority?: number): void;
}

export const subscribeToGestureBus = (gestureBus: GestureBus) => {
  gestureBus.addEventListener("wheel", (delta) => console.log(delta));
};
