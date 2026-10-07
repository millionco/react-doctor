import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnBottomSheetNoStateInOnAnimate } from "./rn-bottom-sheet-no-state-in-on-animate.js";

describe("rn-bottom-sheet-no-state-in-on-animate", () => {
  it("flags a direct useState setter call in an inline onAnimate handler", () => {
    const code = `
      import { useState } from "react";
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [isAnimating, setIsAnimating] = useState(false);
        return <BottomSheet onAnimate={() => setIsAnimating(true)} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("starts a React state update");
  });

  it("flags a setter from an auto-imported bare useState call", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [isAnimating, setIsAnimating] = useState(false);
        return <BottomSheet onAnimate={() => setIsAnimating(true)} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves local handlers, import aliases, namespace sheets, and setter aliases", () => {
    const code = `
      import { useState as state } from "react";
      import * as Gorhom from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [index, setIndex] = state(0);
        const updateIndex = setIndex;
        function handleAnimate() {
          if (index > 0) updateIndex(0);
        }
        return <Gorhom.BottomSheetModal onAnimate={handleAnimate} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a setter created through React namespace useState", () => {
    const code = `
      import * as React from "react";
      import { BottomSheet as Sheet } from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [index, setIndex] = React.useState(0);
        return <Sheet onAnimate={() => setIndex(1)} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows animated and shared-value updates", () => {
    const code = `
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => (
        <BottomSheet onAnimate={(fromIndex, toIndex) => { animatedIndex.value = toIndex; }} />
      );
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores setter-like functions not proven to come from React useState", () => {
    const code = `
      import { useState } from "state-library";
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [open, setOpen] = useState(false);
        return <BottomSheet onAnimate={() => setOpen(true)} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores imported and useCallback-wrapped handlers", () => {
    const code = `
      import { useCallback, useState } from "react";
      import BottomSheet from "@gorhom/bottom-sheet";
      import { importedHandler } from "./handlers";
      const Screen = () => {
        const [open, setOpen] = useState(false);
        const wrappedHandler = useCallback(() => setOpen(true), []);
        return <><BottomSheet onAnimate={importedHandler} /><BottomSheet onAnimate={wrappedHandler} /></>;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores setters called only inside a nested callback", () => {
    const code = `
      import { useState } from "react";
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [open, setOpen] = useState(false);
        return <BottomSheet onAnimate={() => queueMicrotask(() => setOpen(true))} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a setter shadowed inside the handler", () => {
    const code = `
      import { useState } from "react";
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [open, setOpen] = useState(false);
        return <BottomSheet onAnimate={() => { const setOpen = logger.info; setOpen("moving"); }} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag state updates in other Bottom Sheet callbacks", () => {
    const code = `
      import { useState } from "react";
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = () => {
        const [index, setIndex] = useState(0);
        return <BottomSheet onChange={(nextIndex) => setIndex(nextIndex)} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a locally shadowed BottomSheet import", () => {
    const code = `
      import { useState } from "react";
      import BottomSheet from "@gorhom/bottom-sheet";
      const Screen = ({ BottomSheet }) => {
        const [open, setOpen] = useState(false);
        return <BottomSheet onAnimate={() => setOpen(true)} />;
      };
    `;
    const result = runRule(rnBottomSheetNoStateInOnAnimate, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
