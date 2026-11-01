// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// weakness: name-heuristic
// source: independent synthetic native touchend pragma literal review

const label = "@jsx customElement";
void label;
export const Screen = () => (
  <div onTouchEnd={(event) => console.log(event.changedTouches[0].clientX)} />
);
