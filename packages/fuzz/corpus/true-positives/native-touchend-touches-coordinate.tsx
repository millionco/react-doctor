// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: fail
// weakness: ordinary native release coordinates require the removed touch list
// source: independently synthetic native host event
import type { TouchEvent } from "react";

export const TouchSurface = () => (
  <button
    onTouchEnd={(event: TouchEvent<HTMLButtonElement>) => console.log(event.touches[0].clientX)}
  >
    Touch
  </button>
);
