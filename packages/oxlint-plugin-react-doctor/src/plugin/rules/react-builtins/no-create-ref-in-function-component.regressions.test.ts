import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

describe("react-builtins/no-create-ref-in-function-component — regressions", () => {
  // FN hunt (internxt useDriveItemActions): a useMemo-wrapped createRef runs
  // during the hook's render — the memo callback is transparent, and useRef
  // is still the right API.
  it("flags useMemo(() => createRef(), []) inside a custom hook", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useMemo } from 'react';
const useDriveItemActions = (item) => {
  const nameInputRef = useMemo(() => createRef(), []);
  return { nameInputRef };
};
export default useDriveItemActions;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("flags useMemo(() => createRef(), []) inside a component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef, useMemo } from 'react';
function Editor() {
  const inputRef = React.useMemo(() => createRef(), []);
  return <input ref={inputRef} />;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBe(1);
  });

  it("stays silent for a useMemo createRef outside any component or hook", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useMemo } from 'react';
const buildRegistry = () => {
  const slot = useMemo(() => createRef(), []);
  return slot;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for createRef inside an event handler callback", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from 'react';
function Editor() {
  return <button onClick={() => { const scratch = createRef(); void scratch; }}>x</button>;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for render-local refs used only as React attachment sinks", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, type RefObject } from "react";

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

interface PendingAdapterProps {
  isPending: boolean;
}

const Navigation = ({ focusControl }: NavigationProps) => (
  <button ref={focusControl.refs.close}>Close navigation</button>
);

export const PendingAdapter = ({ isPending }: PendingAdapterProps) => {
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
      <div>Navigation</div>
    </>
  );
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a render-local ref whose identity is observed after attachment", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useLayoutEffect, type RefObject } from "react";

interface ObservedRefProps {
  label: string;
  observe(ref: RefObject<HTMLButtonElement | null>): void;
}

export const ObservedRef = ({ label, observe }: ObservedRefProps) => {
  const target = createRef<HTMLButtonElement>();
  useLayoutEffect(() => observe(target), [observe, target]);
  return <button ref={target}>{label}</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for an observed useRef equivalent", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { useLayoutEffect, useRef, type RefObject } from "react";

interface StableObservedRefProps {
  label: string;
  observe(ref: RefObject<HTMLButtonElement | null>): void;
}

export const StableObservedRef = ({ label, observe }: StableObservedRefProps) => {
  const target = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => observe(target), [observe, target]);
  return <button ref={target}>{label}</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
