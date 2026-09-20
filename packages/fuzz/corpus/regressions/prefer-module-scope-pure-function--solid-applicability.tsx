// rule: prefer-module-scope-pure-function
// verdict: pass
// weakness: framework-gating
// source: aidenybai/react-grab a307f9bf57075bcc323fcdd44d24f1179faaee03 packages/react-grab/src/components/overlay-canvas.tsx
import type { Component } from "solid-js";

export const Canvas: Component = () => {
  const parseSize = (value) => Number.parseFloat(value);
  const stopEvent = (event) => event.stopPropagation();
  return <canvas class="overlay" on:pointerdown={stopEvent} width={parseSize("200")} />;
};
