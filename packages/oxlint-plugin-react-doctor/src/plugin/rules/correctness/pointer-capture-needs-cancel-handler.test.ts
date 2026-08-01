import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { pointerCaptureNeedsCancelHandler } from "./pointer-capture-needs-cancel-handler.js";

describe("pointer-capture-needs-cancel-handler", () => {
  it("flags a captured drag that cleans up only on pointer-up", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const Slider = () => (
        <div
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startDrag(event); }}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
        />
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves a local pointer-down handler", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const Slider = () => {
        const begin = (pointerEvent) => pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
        return <div onPointerDown={begin} onPointerMove={move} onPointerUp={finish} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves React useCallback-wrapped pointer-down handlers", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `import React, { useCallback as memoizeHandler } from "react";
       const Slider = () => {
         const first = memoizeHandler(
           (event) => (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId),
           [],
         );
         const second = React.useCallback((event) => {
           try {
             event.currentTarget.setPointerCapture?.(event.pointerId);
           } catch {}
         }, []);
         return <>
           <button onPointerDown={first} onPointerMove={move} onPointerUp={finish} />
           <button onPointerDown={second} onPointerMove={move} onPointerUp={finish} />
         </>;
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves a local function passed to React useCallback", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `import { useCallback } from "react";
       const Slider = () => {
         const capture = (event) => event.currentTarget.setPointerCapture(event.pointerId);
         const begin = useCallback(capture, []);
         return <button onPointerDown={begin} onPointerMove={move} onPointerUp={finish} />;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes transparent wrappers around the captured pointer", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const Slider = () => <>
        <div onPointerDown={(event) => (event.currentTarget as any).setPointerCapture(event.pointerId)} onPointerMove={move} onPointerUp={finish} />
        <div onPointerDown={(event) => event.currentTarget!.setPointerCapture(event.pointerId!)} onPointerMove={move} onPointerUp={finish} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts pointer-cancel and lost-capture cleanup", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const capture = (event) => event.currentTarget.setPointerCapture(event.pointerId);
       const A = () => <div onPointerDown={capture} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} />;
       const B = () => <div onPointerDown={capture} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts cancellation cleanup with a useCallback-wrapped handler", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `import { useCallback } from "react";
       const Slider = () => {
         const capture = useCallback(
           (event) => event.currentTarget.setPointerCapture(event.pointerId),
           [],
         );
         return <>
           <button onPointerDown={capture} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} />
           <button onPointerDown={capture} onPointerMove={move} onPointerUp={finish} onLostPointerCapture={finish} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores local useCallback lookalikes and unresolved handlers", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `import { importedCapture } from "./drag";
       const useCallback = (callback) => callback;
       const Slider = ({ captureFromProps }) => {
         const localLookalike = useCallback(
           (event) => event.currentTarget.setPointerCapture(event.pointerId),
           [],
         );
         return <>
           <button onPointerDown={localLookalike} onPointerMove={move} onPointerUp={finish} />
           <button onPointerDown={importedCapture} onPointerMove={move} onPointerUp={finish} />
           <button onPointerDown={captureFromProps} onPointerMove={move} onPointerUp={finish} />
         </>;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps custom components quiet with a useCallback-wrapped handler", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `import { useCallback } from "react";
       const Slider = () => {
         const capture = useCallback(
           (event) => event.currentTarget.setPointerCapture(event.pointerId),
           [],
         );
         return <DragSurface onPointerDown={capture} onPointerMove={move} onPointerUp={finish} />;
       };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips non-captured and incomplete pointer interactions", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const A = () => <div onPointerDown={start} onPointerMove={move} onPointerUp={finish} />;
       const B = () => <div onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerUp={finish} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips custom components, spreads, nested callbacks, and mismatched pointer IDs", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const A = () => <DragSurface onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={move} onPointerUp={finish} />;
       const B = () => <div onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={move} onPointerUp={finish} {...props} />;
       const C = () => <div onPointerDown={(event) => () => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={move} onPointerUp={finish} />;
       const D = () => <div onPointerDown={(event) => event.currentTarget.setPointerCapture(other.pointerId)} onPointerMove={move} onPointerUp={finish} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a shadowed pointer event binding", () => {
    const result = runRule(
      pointerCaptureNeedsCancelHandler,
      `const Slider = () => <div onPointerDown={(event) => {
        {
          const event = otherEvent;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }} onPointerMove={move} onPointerUp={finish} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
