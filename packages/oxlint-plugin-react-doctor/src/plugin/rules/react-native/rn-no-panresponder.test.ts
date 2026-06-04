import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoPanresponder } from "./rn-no-panresponder.js";

describe("rn-no-panresponder", () => {
  it("flags a named PanResponder import from react-native", () => {
    const code = `import { View, PanResponder } from "react-native";`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("PanResponder");
    expect(result.diagnostics[0].message).toContain("react-native-gesture-handler");
  });

  it("flags an aliased PanResponder import (resolves the imported name)", () => {
    const code = `import { PanResponder as PR } from "react-native";`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag PanResponder imported from another package", () => {
    const code = `import { PanResponder } from "./my-gestures";`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag other react-native imports", () => {
    const code = `import { View, Text, StyleSheet } from "react-native";`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a local PanResponder binding", () => {
    const code = `const PanResponder = makeResponder();`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Type-only imports are erased at build time → no runtime PanResponder.
  it("does NOT flag a declaration-level `import type`", () => {
    const code = `import type { PanResponder } from "react-native";`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an inline `import { type PanResponder }`", () => {
    const code = `import { View, type PanResponder } from "react-native";`;
    const result = runRule(rnNoPanresponder, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
