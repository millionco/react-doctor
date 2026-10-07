import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFocusInAnimationCompletionHandler } from "./no-focus-in-animation-completion-handler.js";

describe("no-focus-in-animation-completion-handler", () => {
  it("flags DOM ref focus in animation and transition completion handlers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Dialog = () => {
         const inputRef = useRef(null);
         const searchRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <input ref={searchRef} />
           <div onAnimationEnd={() => inputRef.current.focus()} />
           <div onTransitionEnd={function () { searchRef.current.focus(); }} />
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("onAnimationEnd");
    expect(result.diagnostics[1]?.message).toContain("onTransitionEnd");
  });

  it("flags capture-phase animation and transition completion handlers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Dialog = () => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <div onAnimationEndCapture={() => inputRef.current.focus()} />
           <div onTransitionEndCapture={() => inputRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("onAnimationEndCapture");
    expect(result.diagnostics[1]?.message).toContain("onTransitionEndCapture");
  });

  it("flags static computed focus calls through transparent TypeScript wrappers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Dialog = () => {
         const inputRef = useRef<HTMLInputElement | null>(null);
         return <>
           <input ref={inputRef} />
           <div onTransitionEnd={() => {
             (inputRef.current as HTMLInputElement)["focus"]();
             (inputRef.current!)[\`focus\`]();
             (inputRef.current!.focus as () => void)();
           }} />
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves exact local function handlers and const aliases", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const firstRef = useRef(null);
         const secondRef = useRef(null);
         function finishTransition() { firstRef.current.focus(); }
         const aliased = finishTransition;
         const finishAnimation = () => secondRef.current.focus();
         return <>
           <input ref={firstRef} />
           <input ref={secondRef} />
           <section onTransitionEnd={aliased} />
           <section onAnimationEnd={finishAnimation} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves a hoisted function-declaration handler textually after return", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <section onAnimationEnd={finishAnimation} />
         </>;
         function finishAnimation() { inputRef.current.focus(); }
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves named, renamed, default, and namespace React useCallback handlers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import React, { useCallback, useCallback as useStableCallback, useRef } from "react";
       import * as ReactRuntime from "react";
       const Panel = () => {
         const firstRef = useRef(null);
         const secondRef = useRef(null);
         const thirdRef = useRef(null);
         const fourthRef = useRef(null);
         const first = useCallback(() => firstRef.current.focus(), []);
         const second = useStableCallback(() => secondRef.current.focus(), []);
         const third = React.useCallback(() => thirdRef.current.focus(), []);
         const fourth = ReactRuntime["useCallback"](() => fourthRef.current.focus(), []);
         return <>
           <input ref={firstRef} />
           <input ref={secondRef} />
           <input ref={thirdRef} />
           <input ref={fourthRef} />
           <div onAnimationEnd={first} />
           <div onAnimationEnd={second} />
           <div onTransitionEnd={third} />
           <div onTransitionEnd={fourth} />
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(4);
  });

  it("resolves a local function supplied to React useCallback and a direct wrapper", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useCallback, useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         const searchRef = useRef(null);
         const moveFocus = () => inputRef.current.focus();
         const stableHandler = useCallback(moveFocus, []);
         return <>
           <input ref={inputRef} />
           <input ref={searchRef} />
           <div onAnimationEnd={stableHandler} />
           <div onTransitionEnd={useCallback(() => searchRef.current.focus(), [])} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows an attached ref identity in an exact React useCallback dependency list", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useCallback, useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         const finish = useCallback(() => inputRef.current.focus(), [inputRef]);
         return <><input ref={inputRef} /><div onAnimationEnd={finish} /></>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags focus on an intrinsic completion event currentTarget", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `const Panel = () => {
         const finish = (event) => event.currentTarget.focus();
         return <>
           <button onAnimationEnd={(event) => event.currentTarget.focus()} />
           <div tabIndex={-1} onTransitionEnd={finish} />
           <div onAnimationEnd={(event) => other.currentTarget.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("follows synchronous IIFEs but prunes forEach and promise callbacks", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const immediateRef = useRef(null);
         const deferredRef = useRef(null);
         const promiseRef = useRef(null);
         const nestedRef = useRef(null);
         return <>
           <input ref={immediateRef} />
           <input ref={deferredRef} />
           <input ref={promiseRef} />
           <input ref={nestedRef} />
           <div onAnimationEnd={() => {
             (() => immediateRef.current.focus())();
             items.forEach(() => deferredRef.current.focus());
             Promise.resolve().then(() => promiseRef.current.focus());
             const later = () => nestedRef.current.focus();
           }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports each reachable focus call on conditional paths", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const firstRef = useRef(null);
         const secondRef = useRef(null);
         return <>
           <input ref={firstRef} />
           <input ref={secondRef} />
           <div onAnimationEnd={() => {
             if (shouldFocusFirst) firstRef.current.focus();
             else secondRef.current.focus();
           }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores focus calls after return and inside statically false branches", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         const afterReturn = () => { return; inputRef.current.focus(); };
         const falseBranch = () => { if (false) inputRef.current.focus(); };
         return <>
           <input ref={inputRef} />
           <div onAnimationEnd={afterReturn} />
           <div onTransitionEnd={falseBranch} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("prunes class field initializers that do not execute when the handler runs", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <div onAnimationEnd={() => {
             class DeferredFocus { field = inputRef.current.focus(); }
             const DeferredExpression = class { field = inputRef.current.focus(); };
           }} />
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires the focus receiver to originate from an intrinsic React ref", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ editor }) => {
         const unattachedRef = useRef(null);
         const customRef = useRef(null);
         const mixedRef = useRef(null);
         const overwrittenRef = useRef(null);
         const unreachableRef = useRef(null);
         const fakeRef = { current: editor };
         if (false) return <input ref={unreachableRef} />;
         return <>
           <CustomInput ref={customRef} />
           <input ref={mixedRef} />
           <CustomInput ref={mixedRef} />
           <input ref={overwrittenRef} />
           <div onAnimationEnd={() => editor.focus()} />
           <div onAnimationEnd={() => fakeRef.current.focus()} />
           <div onTransitionEnd={() => unattachedRef.current.focus()} />
           <div onTransitionEnd={() => customRef.current.focus()} />
           <div onAnimationEnd={() => mixedRef.current.focus()} />
           <div onAnimationEnd={() => unreachableRef.current.focus()} />
           <div onTransitionEnd={() => {
             overwrittenRef.current = editor;
             overwrittenRef.current.focus();
           }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires an unreassigned direct const useRef binding", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         let reassignedRef = useRef(null);
         let updatedRef = useRef(null);
         const directRef = useRef(null);
         const aliasedRef = directRef;
         reassignedRef = replacementRef;
         updatedRef++;
         return <>
           <input ref={reassignedRef} />
           <input ref={updatedRef} />
           <input ref={aliasedRef} />
           <div onAnimationEnd={() => reassignedRef.current.focus()} />
           <div onTransitionEnd={() => updatedRef.current.focus()} />
           <div onAnimationEndCapture={() => directRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires the attached intrinsic to be programmatically focusable", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const plainDivRef = useRef(null);
         const negativeTabRef = useRef(null);
         const disabledRef = useRef(null);
         const hiddenInputRef = useRef(null);
         const hiddenAttributeRef = useRef(null);
         const hiddenClassRef = useRef(null);
         const hiddenStyleRef = useRef(null);
         return <>
           <div ref={plainDivRef} />
           <div ref={negativeTabRef} tabIndex={-1} />
           <button ref={disabledRef} disabled />
           <input ref={hiddenInputRef} type="hidden" />
           <input ref={hiddenAttributeRef} hidden />
           <input ref={hiddenClassRef} className="hidden" />
           <input ref={hiddenStyleRef} style={{ display: "none" }} />
           <section onAnimationEnd={() => plainDivRef.current.focus()} />
           <section onAnimationEnd={() => negativeTabRef.current.focus()} />
           <section onAnimationEnd={() => disabledRef.current.focus()} />
           <section onAnimationEnd={() => hiddenInputRef.current.focus()} />
           <section onAnimationEnd={() => hiddenAttributeRef.current.focus()} />
           <section onAnimationEnd={() => hiddenClassRef.current.focus()} />
           <section onAnimationEnd={() => hiddenStyleRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires the ref attachment and completion handler to be able to co-execute", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ showTarget }) => {
         const inputRef = useRef(null);
         const finish = () => inputRef.current.focus();
         return showTarget
           ? <input ref={inputRef} />
           : <div onAnimationEnd={finish} />;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores completion handlers defined on unreachable render paths", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         if (false) return <div onAnimationEnd={() => inputRef.current.focus()} />;
         return <input ref={inputRef} />;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires the ref attachment and handler to belong to the same returned JSX tree", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ mode, show }) => {
         const unusedTargetRef = useRef(null);
         const unusedHandlerRef = useRef(null);
         const crossComponentRef = useRef(null);
         const branchRef = useRef(null);
         const unusedTarget = <input ref={unusedTargetRef} />;
         const unusedHandler = <div onAnimationEnd={() => unusedHandlerRef.current.focus()} />;
         const Nested = () => <div onAnimationEnd={() => crossComponentRef.current.focus()} />;
         if (mode === "target") return <input ref={branchRef} />;
         if (mode === "handler") {
           return <div onAnimationEnd={() => branchRef.current.focus()} />;
         }
         return show
           ? <><input ref={unusedHandlerRef} /><input ref={crossComponentRef} /></>
           : <><Nested /><div onAnimationEnd={() => unusedTargetRef.current.focus()} /></>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not infer mounting through unresolved local JSX values or opaque composition", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ show }) => {
         const localValueRef = useRef(null);
         const wrappedRef = useRef(null);
         const localInput = <input ref={localValueRef} />;
         return <>
           {show ? localInput : <div onAnimationEnd={() => localValueRef.current.focus()} />}
           <Wrapper><input ref={wrappedRef} /></Wrapper>
           <div onTransitionEnd={() => wrappedRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a discarded logical-and left operand as rendered JSX", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const discardedTargetRef = useRef(null);
         const discardedHandlerRef = useRef(null);
         return <>
           {(<input ref={discardedTargetRef} /> && false)}
           <div onAnimationEnd={() => discardedTargetRef.current.focus()} />
           <input ref={discardedHandlerRef} />
           {(<div onTransitionEnd={() => discardedHandlerRef.current.focus()} /> && false)}
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("correlates the focus-call path with the rendered ref attachment", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ open }) => {
         const inputRef = useRef(null);
         return <>
           {open && <input ref={inputRef} />}
           <div onAnimationEnd={() => {
             if (!open) inputRef.current.focus();
           }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores statically impossible completion-handler paths", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ open }) => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <div onAnimationEnd={() => {
             if (0) inputRef.current.focus();
             if (open && !open) inputRef.current.focus();
             if (true) return;
             inputRef.current.focus();
           }} />
           <div onTransitionEnd={() => {
             switch ("first") {
               case "second": inputRef.current.focus();
             }
           }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores generator handlers and generator IIFEs", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         function* finish() { inputRef.current.focus(); }
         return <>
           <input ref={inputRef} />
           <div onAnimationEnd={finish} />
           <div onTransitionEnd={() => {
             (function* () { inputRef.current.focus(); })();
           }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores targets excluded by inert, hidden, disabled, or visibility ancestry", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inertRef = useRef(null);
         const hiddenRef = useRef(null);
         const fieldsetRef = useRef(null);
         const invisibleRef = useRef(null);
         const collapsedRef = useRef(null);
         return <>
           <button inert ref={inertRef} />
           <div hidden><button ref={hiddenRef} /></div>
           <fieldset disabled><button ref={fieldsetRef} /></fieldset>
           <button className="invisible" ref={invisibleRef} />
           <div style={{ visibility: "collapse" }}><button ref={collapsedRef} /></div>
           <div onAnimationEnd={() => inertRef.current.focus()} />
           <div onAnimationEnd={() => hiddenRef.current.focus()} />
           <div onAnimationEnd={() => fieldsetRef.current.focus()} />
           <div onAnimationEnd={() => invisibleRef.current.focus()} />
           <div onAnimationEnd={() => collapsedRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores dynamically typed inputs that may be hidden", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = ({ hidden }) => {
         const inputRef = useRef(null);
         return <>
           <input type={hidden ? "hidden" : "text"} ref={inputRef} />
           {hidden && <div onAnimationEnd={() => inputRef.current.focus()} />}
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("treats refs passed to calls or custom-component non-ref props as escaped", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const unresolvedRef = useRef(null);
         const localRef = useRef(null);
         const propRef = useRef(null);
         const inspect = (value) => value;
         observe(unresolvedRef);
         inspect(localRef);
         return <>
           <input ref={unresolvedRef} />
           <input ref={localRef} />
           <input ref={propRef} />
           <CustomInput inputRef={propRef} />
           <div onAnimationEnd={() => unresolvedRef.current.focus()} />
           <div onAnimationEnd={() => localRef.current.focus()} />
           <div onAnimationEnd={() => propRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires direct ref.current focus without an escaping node alias", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         const input = inputRef.current;
         return <>
           <input ref={inputRef} />
           <div onTransitionEnd={() => input.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("treats ref.current and focus-method mutations as uncertain", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const assignedRef = useRef(null);
         const escapedRef = useRef(null);
         assignedRef.current.focus = cleanup;
         mutate(escapedRef.current);
         return <>
           <input ref={assignedRef} />
           <input ref={escapedRef} />
           <div onAnimationEnd={() => assignedRef.current.focus()} />
           <div onAnimationEnd={() => escapedRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("deduplicates a shared focus call wired through multiple handler attributes", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         const finish = () => inputRef.current.focus();
         return <>
           <input ref={inputRef} />
           <div onAnimationEnd={finish} onTransitionEnd={finish} />
           <section onAnimationEndCapture={finish} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses only the authoritative duplicate completion handler", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const staleRef = useRef(null);
         const activeRef = useRef(null);
         return <>
           <input ref={staleRef} />
           <input ref={activeRef} />
           <div onAnimationEnd={() => staleRef.current.focus()} onAnimationEnd={() => cleanup()} />
           <div onTransitionEnd={() => cleanup()} onTransitionEnd={() => activeRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects spread precedence around completion handlers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const firstRef = useRef(null);
         const hiddenRef = useRef(null);
         const secondRef = useRef(null);
         const hiddenAgainRef = useRef(null);
         return <>
           <input ref={firstRef} />
           <input ref={hiddenRef} />
           <input ref={secondRef} />
           <input ref={hiddenAgainRef} />
           <div {...props} onAnimationEnd={() => firstRef.current.focus()} />
           <div onAnimationEnd={() => hiddenRef.current.focus()} {...props} />
           <div onTransitionEnd={() => secondRef.current.focus()} {...{ className: "panel" }} />
           <div onTransitionEnd={() => hiddenAgainRef.current.focus()} {...{ onTransitionEnd: cleanup }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves exact completion handlers from static inline spreads", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <div {...{ onAnimationEnd: () => inputRef.current.focus() }} />
           <div {...{ onTransitionEnd: () => cleanup() }} />
         </>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports exact attached React createRef receivers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import React, { createRef } from "react";
       const firstRef = createRef();
       const secondRef = React.createRef();
       const finish = () => firstRef.current.focus();
       const Panel = () => <>
         <input ref={firstRef} />
         <button ref={secondRef} />
         <div onAnimationEnd={finish} />
         <div onTransitionEnd={() => secondRef.current.focus()} />
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet for custom components and member-expression components", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <AnimatedPanel onAnimationEnd={() => inputRef.current.focus()} />
           <motion.div onTransitionEnd={() => inputRef.current.focus()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for imported, opaque, shadowed, and unrelated handlers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useCallback as customUseCallback } from "@custom/hooks";
       import { finishAnimation } from "./animation";
       const useCallback = (callback) => callback;
       const handlers = { finish: () => editor.focus() };
       const first = useCallback(() => editor.focus(), []);
       const second = customUseCallback(() => editor.focus(), []);
       const React = { useCallback };
       const third = React.useCallback(() => editor.focus(), []);
       const Panel = ({ onDone }) => <>
         <div onAnimationEnd={finishAnimation} />
         <div onTransitionEnd={handlers.finish} />
         <div onAnimationEnd={onDone} />
         <div onAnimationEnd={first} />
         <div onAnimationEnd={second} />
         <div onTransitionEnd={third} />
       </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for reassigned local handlers", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         function finish() { inputRef.current.focus(); }
         finish = cleanup;
         return <><input ref={inputRef} /><div onAnimationEnd={finish} /></>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for dynamic event props, dynamic focus members, and visual cleanup", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const eventProps = { onAnimationEnd: () => editor.focus() };
       const method = "focus";
       const Panel = () => {
         const inputRef = useRef(null);
         return <>
           <input ref={inputRef} />
           <div {...eventProps} />
           <div onAnimationEnd={() => inputRef.current[method]()} />
           <div onTransitionEnd={() => inputRef.current.classList.remove("animating")} />
           <div onTransitionEnd={() => inputRef.current.blur()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when focus is moved outside the completion handler", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         const openPanel = () => { setOpen(true); inputRef.current.focus(); };
         return <><input ref={inputRef} /><div onAnimationEnd={() => setAnimating(false)} /></>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not follow local or imported helper calls from the completion handler", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       import { focusSearch } from "./focus";
       const Panel = () => {
         const inputRef = useRef(null);
         const focusInput = () => inputRef.current.focus();
         return <>
           <input ref={inputRef} />
           <div onAnimationEnd={() => focusInput()} />
           <div onTransitionEnd={() => focusSearch()} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a concise handler returning a function as immediate execution", () => {
    const result = runRule(
      noFocusInAnimationCompletionHandler,
      `import { useRef } from "react";
       const Panel = () => {
         const inputRef = useRef(null);
         return <><input ref={inputRef} /><div onAnimationEnd={() => () => inputRef.current.focus()} /></>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
