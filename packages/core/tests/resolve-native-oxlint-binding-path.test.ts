import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveNativeOxlintBindingPath } from "../src/runners/oxlint/resolve-paths.js";

describe("resolveNativeOxlintBindingPath", () => {
  it("keeps stock Oxlint unless an explicit binding path is configured", () => {
    expect(resolveNativeOxlintBindingPath({})).toBeNull();
    expect(resolveNativeOxlintBindingPath({ REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH: "  " })).toBe(
      null,
    );
  });

  it("resolves a configured binding path from the current working directory", () => {
    expect(
      resolveNativeOxlintBindingPath({
        REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH: "./dist/oxlint.node",
      }),
    ).toBe(path.resolve("./dist/oxlint.node"));
  });
});
