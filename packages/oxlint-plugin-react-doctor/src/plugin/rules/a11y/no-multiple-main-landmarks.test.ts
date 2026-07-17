import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMultipleMainLandmarks } from "./no-multiple-main-landmarks.js";

describe("no-multiple-main-landmarks", () => {
  it("reports every additional main in one static tree", () => {
    const result = runRule(
      noMultipleMainLandmarks,
      `const Page = () => <><main /><div><main /></div><main /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows one main per component or alternate render root", () => {
    const result = runRule(
      noMultipleMainLandmarks,
      `const A = () => <main />; const B = () => <main />; const Page = ({ mobile }) => mobile ? <main /> : <main />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips custom main components", () => {
    const result = runRule(noMultipleMainLandmarks, `const Page = () => <><Main /><Main /></>;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
