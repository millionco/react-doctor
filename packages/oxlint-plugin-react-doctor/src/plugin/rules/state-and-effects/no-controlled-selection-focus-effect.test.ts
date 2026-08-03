import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noControlledSelectionFocusEffect } from "./no-controlled-selection-focus-effect.js";

describe("no-controlled-selection-focus-effect", () => {
  it("reports a controlled selection copied into a focus index by a layout effect", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `import { useModernLayoutEffect } from "./use-modern-layout-effect";
export const useListNavigation = ({ enabled, open, floating, selectedIndex, listRef, focusItem }) => {
  const indexRef = useRef(null);
  useModernLayoutEffect(() => {
    if (!enabled || !open || !floating || selectedIndex == null) return;
    indexRef.current = selectedIndex;
    focusItem(listRef, indexRef);
  }, [enabled, open, floating, selectedIndex, listRef, focusItem]);
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports React effects through aliases and TypeScript wrappers", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `import { useLayoutEffect as useCommittedEffect } from "react";
const Picker = ({ selectedKey }: { selectedKey: string }) => {
  const keyRef = useRef<string | null>(null);
  useCommittedEffect(() => {
    keyRef.current = selectedKey as string;
    focusOption((keyRef satisfies typeof keyRef));
  }, [selectedKey]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores navigation focus performed by an event handler", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const Picker = ({ selectedIndex, focusItem }) => {
  const indexRef = useRef(null);
  const navigate = () => {
    indexRef.current = selectedIndex;
    focusItem(indexRef);
  };
  return <button onKeyDown={navigate}>Next</button>;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores local selection state", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const Picker = () => {
  const [selectedIndex] = useState(0);
  const indexRef = useRef(null);
  useLayoutEffect(() => {
    indexRef.current = selectedIndex;
    focusItem(indexRef);
  }, [selectedIndex]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores opening focus that does not rerun for selection changes", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const Picker = ({ open, selectedIndex }) => {
  const indexRef = useRef(null);
  useLayoutEffect(() => {
    if (!open) return;
    indexRef.current = selectedIndex;
    focusItem(indexRef);
  }, [open]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores selection synchronization without a focus action", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const Picker = ({ selectedIndex }) => {
  const indexRef = useRef(null);
  useLayoutEffect(() => {
    indexRef.current = selectedIndex;
    scrollItemIntoView(indexRef);
  }, [selectedIndex]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a focus helper that does not consume the synchronized ref", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const Picker = ({ selectedIndex, triggerRef }) => {
  const indexRef = useRef(null);
  useLayoutEffect(() => {
    indexRef.current = selectedIndex;
    focusTrigger(triggerRef);
  }, [selectedIndex, triggerRef]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a locally declared effect-wrapper lookalike", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const useModernLayoutEffect = (callback) => callback;
const Picker = ({ selectedIndex }) => {
  const indexRef = useRef(null);
  useModernLayoutEffect(() => {
    indexRef.current = selectedIndex;
    focusItem(indexRef);
  }, [selectedIndex]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps direct selection lookups outside the first detector contract", () => {
    const result = runRule(
      noControlledSelectionFocusEffect,
      `const Picker = ({ selectedIndex, itemRefs }) => {
  useLayoutEffect(() => {
    itemRefs.current[selectedIndex]?.focus();
  }, [selectedIndex, itemRefs]);
  return null;
};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
