// rule: remotion-no-css-transition
// weakness: library-idiom
// source: Daytona parity for PR 1533
// verdict: pass
import { useCurrentFrame } from "remotion";

export const DisabledTransitionScene = () => {
  useCurrentFrame();
  return <div style={{ transition: "none", transitionProperty: ` NONE ` }} />;
};
