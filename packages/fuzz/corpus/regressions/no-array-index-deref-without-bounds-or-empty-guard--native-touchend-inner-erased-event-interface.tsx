// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// weakness: alias-guard
// source: independent synthetic readonly native touchend event binding

export const Screen = () => (
  <div
    onTouchEnd={(event) => {
      interface event {}
      console.log(event.changedTouches[0].clientX);
    }}
  />
);
