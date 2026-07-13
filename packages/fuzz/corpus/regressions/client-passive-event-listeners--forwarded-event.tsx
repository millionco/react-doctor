// rule: client-passive-event-listeners
// weakness: event-escape
// source: React Bench siberiacancode/reactuse useContextMenu
export const attachGestureHandler = (element: HTMLElement, onMove: (event: Event) => void) => {
  element.addEventListener("touchmove", (event) => onMove(event));
};
