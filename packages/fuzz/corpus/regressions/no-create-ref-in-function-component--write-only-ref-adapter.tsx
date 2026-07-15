// rule: no-create-ref-in-function-component
// weakness: cross-file
// source: Cloudscape React Bench issue 4461

import { createRef, type RefObject } from "react";

interface FocusControl {
  refs: {
    toggle: RefObject<HTMLButtonElement | null>;
    close: RefObject<HTMLButtonElement | null>;
    slider: RefObject<HTMLDivElement | null>;
  };
  setFocus(): void;
  loseFocus(): void;
}

interface NavigationProps {
  focusControl: FocusControl;
}

const Navigation = ({ focusControl }: NavigationProps) => (
  <button ref={focusControl.refs.close}>Close navigation</button>
);

export const PendingAdapter = ({ isPending }: { isPending: boolean }) => {
  if (!isPending) return <main>Ready content</main>;

  const focusControl: FocusControl = {
    refs: {
      toggle: createRef<HTMLButtonElement>(),
      close: createRef<HTMLButtonElement>(),
      slider: createRef<HTMLDivElement>(),
    },
    setFocus: () => {},
    loseFocus: () => {},
  };

  return (
    <>
      <button ref={focusControl.refs.toggle}>Open navigation</button>
      <Navigation focusControl={focusControl} />
    </>
  );
};
