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

  it("stays silent when a fresh event handler reads the ref from the same render", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  return <button ref={target} onClick={() => target.current?.focus()}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when an async inline event handler reads the ref after suspension", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  return <button ref={target} onClick={async () => { await Promise.resolve(); target.current?.focus(); }}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a dynamic computed destructuring key may extract the ref", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useEffect } from "react";

export const FocusButton = ({ keyName, observe }) => {
  const control = { target: createRef<HTMLButtonElement>() };
  const { [keyName]: extracted } = control;
  useEffect(() => observe(extracted), [extracted, observe]);
  return <button ref={control.target}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for direct intrinsic JSX and React createElement ref sinks", () => {
    const jsxResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => <input ref={createRef<HTMLInputElement>()} />;`,
    );
    const createElementResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = () => {
  const target = createRef<HTMLInputElement>();
  return React.createElement("input", { ref: target });
};`,
    );
    expect(jsxResult.parseErrors).toEqual([]);
    expect(jsxResult.diagnostics).toEqual([]);
    expect(createElementResult.parseErrors).toEqual([]);
    expect(createElementResult.diagnostics).toEqual([]);
  });

  it("stays silent for named-alias and namespace React createElement ref sinks", () => {
    const namedAliasResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createElement as h, createRef } from "react";
export const Input = () => {
  const target = createRef<HTMLInputElement>();
  return h("input", { ref: target });
};`,
    );
    const namespaceResult = runRule(
      noCreateRefInFunctionComponent,
      `import * as ReactRuntime from "react";
export const Input = () => {
  const target = ReactRuntime.createRef<HTMLInputElement>();
  return ReactRuntime.createElement("input", { ref: target });
};`,
    );
    expect(namedAliasResult.parseErrors).toEqual([]);
    expect(namedAliasResult.diagnostics).toEqual([]);
    expect(namespaceResult.parseErrors).toEqual([]);
    expect(namespaceResult.diagnostics).toEqual([]);
  });

  it("reports a ref passed to a userland createElement lookalike", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const createElement = (type, props) => ({ type, props });
export const Input = () => {
  const target = createRef<HTMLInputElement>();
  const input = createElement("input", { ref: target });
  return <>{input}</>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a ref passed through an async helper from a fresh event handler", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  const focusLater = async (ref) => { await Promise.resolve(); ref.current?.focus(); };
  return <button ref={target} onClick={() => { void focusLater(target); }}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an async helper that attaches the ref after suspension", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

const mountLater = async (target) => {
  await Promise.resolve();
  mount(<input ref={target} />);
};

export const Input = () => {
  const target = createRef<HTMLInputElement>();
  void mountLater(target);
  return <main>Input</main>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when a generator event handler can resume with a stale ref", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  return <button ref={target} onClick={function* () { yield; target.current?.focus(); }}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a ref captured by a retained event handler", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useCallback } from "react";

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  const focus = useCallback(() => target.current?.focus(), []);
  return <button ref={target} onClick={focus}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent with a proven closed object spread", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

const closedControls = { setFocus: () => {}, loseFocus: () => {} };

export const FocusButton = () => {
  const control = {
    ...closedControls,
    refs: { target: createRef<HTMLButtonElement>() },
  };
  return <button ref={control.refs.target}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports when the containing object has an unknown spread", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

export const FocusButton = ({ controls }) => {
  const control = {
    ...controls,
    refs: { target: createRef<HTMLButtonElement>() },
  };
  return <button ref={control.refs.target}>Focus</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an on-prefixed handler passed to an unresolved custom component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { RetainingControl } from "opaque-control";

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  return <RetainingControl onFocusRequest={() => target.current?.focus()} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports refs passed through a userland forwardRef lookalike", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";

const forwardRef = (render) => render;
const RefSink = forwardRef((props, ref) => <button {...props} />);

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  return <RefSink ref={target}>Focus</RefSink>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves forwardRef provenance through a local alias", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef, useLayoutEffect } from "react";

const Base = React.forwardRef((props, forwardedRef) => {
  useLayoutEffect(() => { globalThis.observedRef = forwardedRef; }, [forwardedRef]);
  return <button {...props} ref={forwardedRef} />;
});
const Alias = Base;

export const FocusButton = () => {
  const target = createRef<HTMLButtonElement>();
  return <Alias ref={target}>Focus</Alias>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("describes unresolved consumers as uncertain escape", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { UnknownConsumer } from "unknown-package";
export const Input = () => <UnknownConsumer target={createRef()} />;`,
    );
    expect(result.diagnostics[0]?.message).toContain("may escape");
  });

  it("stays silent for unused createRef results and synchronous render IIFEs", () => {
    const unusedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { createRef(); return <input />; };`,
    );
    const iifeResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => {
  const target = createRef();
  return ((forwarded) => <input ref={forwarded} />)(target);
};`,
    );
    const helperResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const renderInput = (forwarded) => <input ref={forwarded} />;
export const Input = () => { const target = createRef(); return renderInput(target); };`,
    );
    expect(unusedResult.diagnostics).toEqual([]);
    expect(iifeResult.diagnostics).toEqual([]);
    expect(helperResult.diagnostics).toEqual([]);
  });

  it("stays silent for intrinsic ref props in closed JSX spreads", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => {
  const first = createRef();
  const second = createRef();
  const props = { ref: second };
  return <><input {...{ ref: first }} /><input {...props} /></>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for callback-ref current writes including cleanup", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => {
  const target = createRef();
  return <input ref={(node) => { target.current = node; return () => { target.current = null; }; }} />;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a callback ref that reads the fresh ref", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => {
  const target = createRef();
  return <input ref={(node) => { observe(target.current); target.current = node; }} />;
};`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks an exact array index into an intrinsic ref sink", () => {
    const cleanResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const tuple = [createRef()]; return <input ref={tuple[0]} />; };`,
    );
    const observedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useEffect } from "react";
export const Input = () => { const tuple = [createRef()]; useEffect(() => observe(tuple[0]), []); return <input ref={tuple[0]} />; };`,
    );
    expect(cleanResult.diagnostics).toEqual([]);
    expect(observedResult.diagnostics).toHaveLength(1);
  });

  it("recognizes proven React class and const intrinsic element ref sinks", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
class LegacyInput extends React.Component { render() { return <input />; } }
const Tag = "input";
export const Input = () => {
  const instance = createRef();
  const element = createRef();
  return <><LegacyInput ref={instance} /><Tag ref={element} /></>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes closed intrinsic unions, aliases, and React class-base aliases", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
const Host = "div";
const Tag = Host;
const Base = React.Component;
class LegacyInput extends Base { render() { return <input />; } }
export const Input = ({ span }) => {
  const UnionTag = span ? "span" : "div";
  const first = createRef(); const second = createRef(); const third = createRef();
  return <><Tag ref={first} /><UnionTag ref={second} /><LegacyInput ref={third} /></>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a userland Component base as a proven class ref sink", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
class Component {}
class UserlandInput extends Component {}
export const Input = () => { const target = createRef(); return <UserlandInput ref={target} />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks a locally owned property assignment into an intrinsic ref sink", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const owner = {}; owner.target = createRef(); return <input ref={owner.target} />; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a fresh handler read after an unknown synchronous call", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); return <button ref={target} onClick={() => { unknownCall(); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a fresh handler read after an unknown getter access", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ controller }) => { const target = createRef(); return <button ref={target} onClick={() => { void controller.value; target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports handler reads after destructuring or spread can execute user code", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ value }) => { const target = createRef(); return <button ref={target} onClick={() => { const { item } = value; const copy = { ...value }; consume(item, copy); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps an ordinary state setter before the fresh handler read safe", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useState } from "react";
export const Input = () => { const [active, setActive] = useState(false); const target = createRef(); return <button aria-pressed={active} ref={target} onClick={() => { setActive(true); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps proven non-committing calls before the fresh handler read safe", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, startTransition } from "react";
export const Input = () => { const target = createRef(); return <button ref={target} onClick={(event) => { event.preventDefault(); event.stopPropagation(); console.log("focus"); startTransition(() => {}); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust shadowed non-committing call lookalikes", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ console, startTransition }) => { const target = createRef(); return <button ref={target} onClick={(event) => { console.log(); startTransition(); event.customPreventDefault(); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still inspects arguments and callbacks of non-committing calls", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, startTransition, useState } from "react";
import { flushSync } from "react-dom";
export const Input = () => { const [active, setActive] = useState(false); const target = createRef(); return <button key={String(active)} ref={target} onClick={(event) => { event.preventDefault(flushSync(() => setActive(true))); startTransition(() => { flushSync(() => setActive(false)); }); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a reassigned useState setter", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useState } from "react";
import { flushSync } from "react-dom";
export const Input = () => { let [active, setActive] = useState(false); const originalSetActive = setActive; setActive = () => flushSync(() => originalSetActive((value) => !value)); const target = createRef(); return <button key={String(active)} ref={target} onClick={() => { setActive(true); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps immutable useState setter aliases before the ref read safe", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useState } from "react";
export const Input = () => { const [active, setActive] = useState(false); const update = setActive; const target = createRef(); return <button aria-pressed={active} ref={target} onClick={() => { update(true); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps render-local identity, Boolean, and void observations local", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const first = createRef(); const second = createRef(); const third = createRef(); void first; const isPresent = Boolean(second); const isSame = third === third; return <input aria-label={String(isPresent && isSame)} />; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("suppresses only a discarded current read during render", () => {
    const discardedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); void target.current; return <input ref={target} />; };`,
    );
    const observedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); return <span>{Boolean(target.current)} {String(target.current)}</span>; };`,
    );
    expect(discardedResult.diagnostics).toEqual([]);
    expect(observedResult.diagnostics).toHaveLength(1);
  });

  it("reports a fresh handler read after a synchronous flush", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useState } from "react";
import { flushSync as commitNow } from "react-dom";
export const Input = () => { const [active, setActive] = useState(false); const target = createRef(); return <button key={String(active)} ref={target} onClick={() => { commitNow(() => setActive((value) => !value)); target.current?.focus(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a loop read that can follow a prior iteration's synchronous flush", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useState } from "react";
import { flushSync } from "react-dom";
export const Input = () => { const [active, setActive] = useState(false); const target = createRef(); return <button key={String(active)} ref={target} onClick={() => { for (let index = 0; index < 2; index += 1) { target.current?.focus(); flushSync(() => setActive((value) => !value)); } }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows an async fresh handler read before suspension", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); return <button ref={target} onClick={async () => { target.current?.focus(); await Promise.resolve(); }}>Focus</button>; };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("supports named, conditional, logical, and nested synchronous fresh handlers", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ enabled }) => {
  const first = createRef(); const second = createRef(); const third = createRef(); const fourth = createRef();
  const named = () => first.current?.focus();
  return <><button ref={first} onClick={named} /><button ref={second} onClick={enabled ? () => second.current?.focus() : undefined} /><button ref={third} onClick={enabled && (() => third.current?.focus())} /><button ref={fourth} onClick={() => { (() => fourth.current?.focus())(); }} /></>;
};`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("uses scope-proven React createRef provenance", () => {
    const positiveResult = runRule(
      noCreateRefInFunctionComponent,
      `import ReactRuntime, { createRef as makeRef } from "react";
const namespaceAlias = ReactRuntime;
const { createRef: destructured } = namespaceAlias;
export const Input = () => { const a = makeRef(); const b = namespaceAlias["createRef"](); const c = destructured(); observe(a, b, c); return <input />; };`,
    );
    const negativeResult = runRule(
      noCreateRefInFunctionComponent,
      `import React from "preact/compat";
const localReact = { createRef: () => ({ current: null }) };
export const Input = () => { React.createRef(); localReact.createRef(); return <input />; };`,
    );
    expect(positiveResult.diagnostics).toHaveLength(3);
    expect(negativeResult.diagnostics).toEqual([]);
  });
});
