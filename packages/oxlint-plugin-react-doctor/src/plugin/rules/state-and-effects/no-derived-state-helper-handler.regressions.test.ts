import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";
import { noInitializeState } from "./no-initialize-state.js";

const AUTHENTIC_GALLERY_HELPER_GRAPH = `import { useCallback, useEffect, useRef, useState } from "react";
function Gallery({ activePhotoIndex }) {
  const [zoomPhotoIndex, setZoomPhotoIndex] = useState(null);
  const zoomStateRef = useRef(null);
  const clearZoomForPhoto = useCallback((photoIndex) => {
    const nextZoomState = { photoIndex, scale: 1, panX: 0, panY: 0 };
    zoomStateRef.current = nextZoomState;
    setZoomPhotoIndex(nextZoomState);
  }, []);
  const updateZoom = useCallback((nextZoomState) => {
    zoomStateRef.current = nextZoomState;
    setZoomPhotoIndex(nextZoomState);
  }, []);
  const resetZoom = useCallback(() => {
    updateZoom({ photoIndex: activePhotoIndex, scale: 1, panX: 0, panY: 0 });
  }, [activePhotoIndex, updateZoom]);
  const onWheel = useCallback(() => {
    updateZoom({ photoIndex: activePhotoIndex, scale: 2, panX: 0, panY: 0 });
  }, [activePhotoIndex, updateZoom]);
  const onTouchMove = useCallback(() => {
    updateZoom({ photoIndex: activePhotoIndex, scale: 3, panX: 0, panY: 0 });
  }, [activePhotoIndex, updateZoom]);
  useEffect(() => resetZoom(), [resetZoom]);
  useEffect(() => clearZoomForPhoto(activePhotoIndex), [activePhotoIndex, clearZoomForPhoto]);
  return <div onTouchMove={onTouchMove} onWheel={onWheel}>{zoomPhotoIndex?.scale}</div>;
}`;

const expectDiagnosticCount = (code: string, diagnosticCount: number): void => {
  const result = runRule(noDerivedState, code, { forceJsx: true });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("no-derived-state helper-owned event state", () => {
  it("stays silent for the authentic mixed event and effect helper graph", () => {
    expectDiagnosticCount(AUTHENTIC_GALLERY_HELPER_GRAPH, 0);
  });

  it("keeps the authentic graph quiet across the derived-state family", () => {
    for (const rule of [noDerivedStateEffect, noAdjustStateOnPropChange, noInitializeState]) {
      const result = runRule(rule, AUTHENTIC_GALLERY_HELPER_GRAPH, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("reports when the helper is only reached from an effect", () => {
    expectDiagnosticCount(
      `import { useCallback, useEffect, useState } from "react";
      function Gallery({ activePhotoIndex }) {
        const [zoomPhotoIndex, setZoomPhotoIndex] = useState(null);
        const updateZoom = useCallback((nextPhotoIndex) => setZoomPhotoIndex(nextPhotoIndex), []);
        useEffect(() => updateZoom(activePhotoIndex), [activePhotoIndex, updateZoom]);
        return <div>{zoomPhotoIndex}</div>;
      }`,
      1,
    );
  });

  it("does not treat a render-time helper invocation as an event write", () => {
    expectDiagnosticCount(
      `import { useEffect, useState } from "react";
      function Example({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        return <div>{draft}</div>;
      }`,
      1,
    );
  });

  it("accepts direct, one-hop, and multi-hop immutable event paths", () => {
    expectDiagnosticCount(
      `import { useCallback, useEffect, useState } from "react";
      function Direct({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = useCallback((nextValue) => setDraft(nextValue), []);
        useEffect(() => updateDraft(value), [updateDraft, value]);
        return <div onWheel={updateDraft}>{draft}</div>;
      }
      function OneHop({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const onWheel = () => updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function MultiHop({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = useCallback((nextValue) => setDraft(nextValue), []);
        const commitDraft = useCallback((nextValue) => updateDraft(nextValue), [updateDraft]);
        const onWheel = useCallback(() => commitDraft(value), [commitDraft, value]);
        useEffect(() => updateDraft(value), [updateDraft, value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function InlineWrapper({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={() => updateDraft(value)}>{draft}</div>;
      }
      function HandlerFactory({ value }) {
        const [draft, setDraft] = useState("");
        const getChangeHandler = useCallback(
          (field) => (nextValue) => setDraft({ ...value, [field]: nextValue }),
          [value],
        );
        useEffect(() => setDraft(value), [value]);
        return <input onChange={getChangeHandler("name")} value={draft.name} />;
      }`,
      0,
    );
  });

  it("resolves renamed and namespace React useCallback bindings", () => {
    expectDiagnosticCount(
      `import React, { useCallback as useStableCallback, useEffect, useState } from "react";
      function Renamed({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = useStableCallback((nextValue) => setDraft(nextValue), []);
        const onWheel = useStableCallback(() => updateDraft(value), [updateDraft, value]);
        useEffect(() => updateDraft(value), [updateDraft, value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function Namespaced({ value }) {
        const [draft, setDraft] = React.useState("");
        const updateDraft = React.useCallback((nextValue) => setDraft(nextValue), []);
        const onWheel = React.useCallback(() => updateDraft(value), [updateDraft, value]);
        React.useEffect(() => updateDraft(value), [updateDraft, value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }`,
      0,
    );
  });

  it("rejects userland wrappers, mutable aliases, and escaped helpers", () => {
    expectDiagnosticCount(
      `import { useEffect, useState } from "react";
      const register = () => undefined;
      function Userland({ value }) {
        const useCallback = (callback) => callback;
        const [draft, setDraft] = useState("");
        const updateDraft = useCallback((nextValue) => setDraft(nextValue), []);
        const onWheel = () => updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function MutableAlias({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        let onWheel = updateDraft;
        onWheel = () => updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function Escaped({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const onWheel = () => updateDraft(value);
        register(updateDraft);
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }`,
      3,
    );
  });

  it("rejects nested callback factories and non-handler logical values", () => {
    expectDiagnosticCount(
      `import { useEffect, useMemo, useState } from "react";
      const register = (callback) => callback;
      function RegisteredCallback({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const buildRegisteredHandler = () => register(() => updateDraft(value));
        useEffect(() => updateDraft(value), [value]);
        return <div onClick={buildRegisteredHandler()}>{draft}</div>;
      }
      function MemoCallback({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const buildMemoHandler = () => useMemo(() => updateDraft(value), []);
        useEffect(() => updateDraft(value), [value]);
        return <div onClick={buildMemoHandler()}>{draft}</div>;
      }
      function LogicalValue({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const maybeUpdate = () => updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        return <div onClick={maybeUpdate && false}>{draft}</div>;
      }`,
      3,
    );
  });

  it("rejects async, generator, and unreachable helper paths", () => {
    expectDiagnosticCount(
      `import { useEffect, useState } from "react";
      function AsyncPath({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const onWheel = async () => updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function GeneratorPath({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const wheelWork = function* () { updateDraft(value); };
        const onWheel = () => wheelWork().next();
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function UnreachableCall({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const onWheel = () => {
          if (false) updateDraft(value);
        };
        useEffect(() => updateDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function UnreachableSetter({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => {
          return;
          setDraft(nextValue);
        };
        const onWheel = () => updateDraft(value);
        useEffect(() => setDraft(value), [value]);
        return <div onWheel={onWheel}>{draft}</div>;
      }
      function UnreachableDirectEventReference({ value }) {
        const [draft, setDraft] = useState("");
        const updateDraft = (nextValue) => setDraft(nextValue);
        const onWheel = () => updateDraft(value);
        useEffect(() => updateDraft(value), [value]);
        if (false) return <div onWheel={onWheel}>{draft}</div>;
        return <div>{draft}</div>;
      }
      function UnreachableInlineCall({ value }) {
        const [draft, setDraft] = useState("");
        const commitDraft = (nextValue) => setDraft(nextValue);
        const updateDraft = () => commitDraft(value);
        useEffect(() => commitDraft(value), [value]);
        return <div onWheel={() => {
          if (false) updateDraft();
        }}>{draft}</div>;
      }`,
      6,
    );
  });
});
