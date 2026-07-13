// rule: style-prop-object
// weakness: framework-gating
// source: React Bench migrate-react-opencode-solid-to__djiDntJ
import { createSignal } from "solid-js";

export const SolidTreeGuide = () => {
  const [level] = createSignal(1);
  return (
    <div
      class="absolute"
      classList={{ active: level() > 0 }}
      style={`left: ${Math.max(0, 8 + level() * 12 - 4) + 8}px`}
    />
  );
};
