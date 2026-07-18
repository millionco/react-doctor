// rule: pointer-capture-needs-cancel-handler
// source: PR #1337 fuzz verdict-drop

export const Slider = () => (
  <div
    onPointerDown={(event) => (event.currentTarget as any).setPointerCapture(event.pointerId!)}
    onPointerMove={move}
    onPointerUp={finish}
  />
);
