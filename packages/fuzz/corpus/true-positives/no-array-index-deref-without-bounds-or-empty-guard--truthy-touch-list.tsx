// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: control-flow
// source: Cursor Bugbot review on PR #1387
export const register = (element: Element): void => {
  element.addEventListener("touchend", (event) => {
    if (event.touches) consume(event.touches[0].clientX);
  });
};
