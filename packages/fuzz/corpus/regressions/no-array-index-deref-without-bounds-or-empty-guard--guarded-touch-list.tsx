// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: control-flow
// source: adversarial audit of guard/optional-access rules
export const register = (element: Element): void => {
  element.addEventListener("touchend", (event) => {
    if (event.touches.length === 0) return;
    consume(event.touches[0].clientX);
  });
};
