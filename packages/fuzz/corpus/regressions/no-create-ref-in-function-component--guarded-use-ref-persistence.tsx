// rule: no-create-ref-in-function-component
// verdict: pass
// weakness: control-flow
// source: React Bench fix-react-cloudscape-design-comp__mun7kHG

import { createRef, useRef } from "react";

const Navigation = ({ focusControl }: { focusControl: unknown }) => (
  <div data-has-focus-control={Boolean(focusControl)} />
);

export const PendingNavigation = () => {
  const focusControlRef = useRef<{
    refs: {
      toggle: ReturnType<typeof createRef>;
      close: ReturnType<typeof createRef>;
      slider: ReturnType<typeof createRef>;
    };
  }>();

  if (!focusControlRef.current) {
    focusControlRef.current = {
      refs: {
        toggle: createRef(),
        close: createRef(),
        slider: createRef(),
      },
    };
  }

  return <Navigation focusControl={focusControlRef.current} />;
};
