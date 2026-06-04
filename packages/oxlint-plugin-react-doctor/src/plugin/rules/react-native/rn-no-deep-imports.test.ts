import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnNoDeepImports } from "./rn-no-deep-imports.js";

describe("rn-no-deep-imports", () => {
  it("flags a deep import of a public export (Alert)", () => {
    const code = `import { Alert } from "react-native/Libraries/Alert/Alert";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('from "react-native"');
  });

  it("flags a default deep import of a public export (View)", () => {
    const code = `import View from "react-native/Libraries/Components/View/View";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the relocated NewAppScreen with a tailored message", () => {
    const code = `import { Colors } from "react-native/Libraries/NewAppScreen";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("@react-native/new-app-screen");
  });

  it("flags a re-export from a deep public path", () => {
    const code = `export { Text } from "react-native/Libraries/Text/Text";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags export * from a deep public path", () => {
    const code = `export * from "react-native/Libraries/StyleSheet/StyleSheet";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag the package root import", () => {
    const code = `import { Alert, View } from "react-native";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag Codegen / internal-only deep paths (no root equivalent)", () => {
    const code = `
      import type { TurboModule } from "react-native/Libraries/TurboModule/RCTExport";
      import resolveAssetSource from "react-native/Libraries/Image/resolveAssetSource";
      import { polyfillGlobal } from "react-native/Libraries/Utilities/PolyfillFunctions";
    `;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag type-only imports", () => {
    const code = `import type { ViewProps } from "react-native/Libraries/Components/View/View";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Regression (Bugbot): an inline all-type import is type-only even though the
  // declaration importKind is "value" — treat it like `import type`.
  it("does NOT flag an inline all-type import (`import { type X }`)", () => {
    const code = `import { type ColorSchemeName } from "react-native/Libraries/Utilities/Appearance";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an inline all-type re-export (`export { type X } from`)", () => {
    const code = `export { type ViewProps } from "react-native/Libraries/Components/View/View";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  // A mixed value+type import still has a value specifier → still flagged.
  it("flags a mixed value+inline-type import (value specifier present)", () => {
    const code = `import { View, type ViewProps } from "react-native/Libraries/Components/View/View";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag tooling subpaths outside Libraries/", () => {
    const code = `
      import preset from "react-native/jest-preset";
      import "react-native/jest/setup";
    `;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a relative path that merely contains the substring", () => {
    const code = `import x from "./react-native/Libraries/Alert/Alert";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a jest.mock of a deep path (not an import statement)", () => {
    const code = `jest.mock("react-native/Libraries/Animated/NativeAnimatedHelper");`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Regression (RDE eval): `react-native/Libraries/Animated/Easing` is a
  // namespace module whose sub-exports (`linear`) are not root-named, so
  // "import from react-native" would be wrong — must stay quiet.
  it("does NOT flag a namespace-module sub-export import (Animated/Easing → linear)", () => {
    const code = `import { linear } from "react-native/Libraries/Animated/Easing";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Regression (RDE eval): a leaf component module is also the source of its
  // associated types (`NativeScrollEvent` from `ScrollView/ScrollView`), all
  // root-exported — flag it, but with a generic (non-symbol-naming) message.
  it("flags a type imported from a leaf component module with a generic message", () => {
    const code = `import { NativeScrollEvent } from "react-native/Libraries/Components/ScrollView/ScrollView";`;
    const result = runRule(rnNoDeepImports, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('from "react-native"');
    expect(result.diagnostics[0].message).not.toContain("{ ScrollView }");
  });
});
