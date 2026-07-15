import { fileURLToPath } from "node:url";
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

  it("flags aliased React useMemo and createRef calls inside a custom hook", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef as makeRef, useMemo as cache } from "react";
const useThing = () => cache(() => makeRef(), []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a userland useMemo callback as render-transparent", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const useMemo = (callback) => callback();
export const Input = () => {
  const target = useMemo(() => createRef(), []);
  return <input data-present={Boolean(target)} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  it("reports comparison against another ref identity", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ previousTarget }) => {
  const target = createRef();
  const didRefIdentityChange = target !== previousTarget;
  return <input ref={target} data-changed={didRefIdentityChange} />;
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

  it("stays silent for intrinsic cloneElement and aliased createElement props", () => {
    const cloneElementResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = () => { const target = createRef(); return React.cloneElement(<input />, { ref: target }); };`,
    );
    const aliasedPropsResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = () => { const target = createRef(); const props = { ref: target }; return React.createElement("input", props); };`,
    );
    expect(cloneElementResult.diagnostics).toEqual([]);
    expect(aliasedPropsResult.diagnostics).toEqual([]);
  });

  it("reports cloneElement refs on custom elements and aliased props that escape", () => {
    const customElementResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
const Custom = () => <input />;
export const Input = () => { const target = createRef(); return React.cloneElement(<Custom />, { ref: target }); };`,
    );
    const escapedPropsResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = ({ observe }) => { const target = createRef(); const props = { ref: target }; observe(props); return React.createElement("input", props); };`,
    );
    expect(customElementResult.diagnostics).toHaveLength(1);
    expect(escapedPropsResult.diagnostics).toHaveLength(1);
  });

  it("reports intrinsic element results that retain the ref beyond the render", () => {
    const jsxResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); retain(<input ref={target} />); return <div />; };`,
    );
    const aliasResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); const element = <input ref={target} />; retain(element); return <div />; };`,
    );
    const createElementResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); retain(React.createElement("input", { ref: target })); return <div />; };`,
    );
    const cloneElementResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); retain(React.cloneElement(<input />, { ref: target })); return <div />; };`,
    );
    expect(jsxResult.diagnostics).toHaveLength(1);
    expect(aliasResult.diagnostics).toHaveLength(1);
    expect(createElementResult.diagnostics).toHaveLength(1);
    expect(cloneElementResult.diagnostics).toHaveLength(1);
  });

  it("reports an intrinsic ref hidden beneath a local component that retains children", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const Sink = ({ children, retain }) => { retain(children); return null; };
export const Input = ({ retain }) => { const target = createRef(); return <Sink retain={retain}><input ref={target} /></Sink>; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports intrinsic refs hidden beneath unresolved custom component children", () => {
    const directResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { Sink } from "opaque";
export const Input = () => { const target = createRef(); return <Sink><input ref={target} /></Sink>; };`,
    );
    const conditionalResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { Sink } from "opaque";
export const Input = ({ visible }) => { const target = createRef(); return <Sink>{visible && <input ref={target} />}</Sink>; };`,
    );
    expect(directResult.diagnostics).toHaveLength(1);
    expect(conditionalResult.diagnostics).toHaveLength(1);
  });

  it("distinguishes resolved imported children forwarding from retention", () => {
    const filename = fileURLToPath(
      new URL("./__fixtures__/create-ref-children-consumer.tsx", import.meta.url),
    );
    const forwardingResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { ForwardingChildren } from "./create-ref-children-consumers";
export const Input = () => { const target = createRef(); return <ForwardingChildren><input ref={target} /></ForwardingChildren>; };`,
      { filename },
    );
    const retainingResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { RetainingChildren } from "./create-ref-children-consumers";
export const Input = ({ retain }) => { const target = createRef(); return <RetainingChildren retain={retain}><input ref={target} /></RetainingChildren>; };`,
      { filename },
    );
    expect(forwardingResult.diagnostics).toEqual([]);
    expect(retainingResult.diagnostics).toHaveLength(1);
  });

  it("keeps direct and aliased intrinsic element returns quiet", () => {
    const directResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); return <input ref={target} />; };`,
    );
    const aliasResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); const element = <input ref={target} />; return element; };`,
    );
    expect(directResult.diagnostics).toEqual([]);
    expect(aliasResult.diagnostics).toEqual([]);
  });

  it("keeps intrinsic refs beneath proven React fragments quiet", () => {
    const namespaceResult = runRule(
      noCreateRefInFunctionComponent,
      `import React, { createRef } from "react";
export const Input = () => { const target = createRef(); return <React.Fragment><input ref={target} /></React.Fragment>; };`,
    );
    const namedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, Fragment } from "react";
export const Input = () => { const target = createRef(); return <Fragment><input ref={target} /></Fragment>; };`,
    );
    expect(namespaceResult.diagnostics).toEqual([]);
    expect(namedResult.diagnostics).toEqual([]);
  });

  it("reports intrinsic refs beneath shadowed and userland Fragment components", () => {
    const shadowedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const Fragment = ({ children, retain }) => { retain(children); return null; };
export const Input = ({ retain }) => { const target = createRef(); return <Fragment retain={retain}><input ref={target} /></Fragment>; };`,
    );
    const userlandResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { Fragment } from "userland";
export const Input = () => { const target = createRef(); return <Fragment><input ref={target} /></Fragment>; };`,
    );
    expect(shadowedResult.diagnostics).toHaveLength(1);
    expect(userlandResult.diagnostics).toHaveLength(1);
  });

  it("resolves a namespace component that forwards a ref prop to an intrinsic element", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import * as UI from "./create-ref-namespace-child";
export const Input = () => { const target = createRef(); return <UI.Child target={target} />; };`,
      {
        filename: fileURLToPath(
          new URL("./__fixtures__/create-ref-namespace-consumer.tsx", import.meta.url),
        ),
      },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a namespace component that retains the ref prop", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import * as UI from "./create-ref-namespace-child";
export const Input = ({ observe }) => { const target = createRef(); return <UI.RetainingChild target={target} observe={observe} />; };`,
      {
        filename: fileURLToPath(
          new URL("./__fixtures__/create-ref-namespace-consumer.tsx", import.meta.url),
        ),
      },
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("stays silent for named functions invoked only during the same render", () => {
    const arrowResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); const render = () => <input ref={target} />; return render(); };`,
    );
    const declarationResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); function render() { return <input ref={target} />; } return render(); };`,
    );
    expect(arrowResult.diagnostics).toEqual([]);
    expect(declarationResult.diagnostics).toEqual([]);
  });

  it("reports named render functions that are retained, deferred, or async", () => {
    const retainedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); const render = () => <input ref={target} />; retain(render); return render(); };`,
    );
    const deferredResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef, useEffect } from "react";
export const Input = () => { const target = createRef(); const render = () => <input ref={target} />; useEffect(render, []); return <main />; };`,
    );
    const asyncResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); const render = async () => <input ref={target} />; void render(); return <main />; };`,
    );
    expect(retainedResult.diagnostics).toHaveLength(1);
    expect(deferredResult.diagnostics).toHaveLength(1);
    expect(asyncResult.diagnostics).toHaveLength(1);
  });

  it("reports a retained result from a synchronous render helper", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const renderInput = (target) => <input ref={target} />;
export const Input = ({ retain }) => { const target = createRef(); retain(renderInput(target)); return <div />; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports discarded render helpers and retained functions that close over elements", () => {
    const discardedResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => { const target = createRef(); const render = () => <input ref={target} />; render(); return <div />; };`,
    );
    const retainedFunctionResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); const element = <input ref={target} />; const make = () => element; retain(make); return <div />; };`,
    );
    expect(discardedResult.diagnostics).toHaveLength(1);
    expect(retainedFunctionResult.diagnostics).toHaveLength(1);
  });

  it("reports a named render-only function that attaches the ref to a custom component", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
import { Unknown } from "unknown-package";
export const Input = () => { const target = createRef(); const render = () => <Unknown ref={target} />; return render(); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a ref passed through a component binding reassigned before render", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
let Sink = ({ target }) => <input ref={target} />;
Sink = ({ target, observe }) => {
  observe(target);
  return null;
};
export const Input = ({ observe }) => {
  const target = createRef();
  return <Sink target={target} observe={observe} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("reports intrinsic JSX spread refs when the element result escapes", () => {
    const inlineResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); retain(<input {...{ ref: target }} />); return <div />; };`,
    );
    const aliasResult = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = ({ retain }) => { const target = createRef(); const props = { ref: target }; retain(<input {...props} />); return <div />; };`,
    );
    expect(inlineResult.diagnostics).toHaveLength(1);
    expect(aliasResult.diagnostics).toHaveLength(1);
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

  it("reports callback-ref writes deferred through another closure", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
export const Input = () => {
  const target = createRef();
  return <input ref={(node) => { queueMicrotask(() => { target.current = node; }); }} />;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("recognizes props.children forwarded during the same render", () => {
    const result = runRule(
      noCreateRefInFunctionComponent,
      `import { createRef } from "react";
const Wrapper = (props) => <section>{props.children}</section>;
export const Input = () => {
  const target = createRef();
  return <Wrapper><input ref={target} /></Wrapper>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
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
