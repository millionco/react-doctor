// rule: no-unknown-property
// verdict: pass
// weakness: framework-gating
// source: aidenybai/react-grab a307f9bf57075bcc323fcdd44d24f1179faaee03 packages/react-grab/src/components/icons/icon-check.tsx
import type { Component as View } from "solid-js";

export const Icon: View = () => (
  <svg class="icon">
    <path class="stroke" d="M0 0" />
  </svg>
);
