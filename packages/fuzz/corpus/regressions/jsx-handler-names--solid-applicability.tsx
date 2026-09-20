// rule: jsx-handler-names
// verdict: pass
// weakness: framework-gating
// source: aidenybai/react-grab a307f9bf57075bcc323fcdd44d24f1179faaee03 packages/react-grab/src/components/selection-label/completion-view.tsx
import { Show as Conditional } from "solid-js";

export const Panel = (props) => (
  <Conditional when={props.onRetry}>
    <button on:pointerdown={props.onPointerDown} />
  </Conditional>
);
