// rule: three-no-state-in-pointer-move
// weakness: framework-gating
// source: Bugbot review on PR #1424
// verdict: pass

import { useState } from "react";

export const DrawingCanvas = () => {
  const [, setPointerX] = useState(0);
  return <canvas onPointerMove={(event) => setPointerX(event.clientX)} />;
};
