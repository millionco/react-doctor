import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { displayName } from "./display-name.js";

const runJsx = (code: string, settings?: Readonly<Record<string, unknown>>) =>
  runRule(displayName, code, { filename: "fixture.jsx", settings });

describe("react-builtins/display-name — regressions: extended HoC awareness", () => {
  it("flags an anonymous component wrapped in `React.memo`", () => {
    const result = runJsx(`
      module.exports = React.memo(function () { return <div /> });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in `React.forwardRef`", () => {
    const result = runJsx(`
      module.exports = React.forwardRef((props, ref) => <div ref={ref} />);
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in MobX `observer` by default", () => {
    const result = runJsx(`
      module.exports = observer(function () { return <div /> });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in `lazy(() => ...)` by default", () => {
    const result = runJsx(`
      module.exports = lazy(() => <div />);
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in `withTracking` by default", () => {
    const result = runJsx(`
      module.exports = withTracking(function () { return <div /> });
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an anonymous component wrapped in a project-custom HoC via settings", () => {
    const result = runJsx(
      `
      module.exports = withRedux(function () { return <div /> });
    `,
      {
        "react-doctor": {
          displayName: { additionalHoCs: ["withRedux"] },
        },
      },
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a named function inside `observer`", () => {
    const result = runJsx(`
      module.exports = observer(function MyComponent() { return <div /> });
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a custom HoC name when it isn't in the settings list", () => {
    const result = runJsx(`
      module.exports = withRedux(function () { return <div /> });
    `);
    // \`withRedux\` is not in the DEFAULT additionalHoCs and not memo/forwardRef.
    // No diagnostic.
    expect(result.diagnostics).toEqual([]);
  });

  it("allows users to override the default `observer` recognition by setting additionalHoCs explicitly", () => {
    const result = runJsx(
      `
      module.exports = observer(function () { return <div /> });
    `,
      {
        "react-doctor": {
          displayName: { additionalHoCs: [] },
        },
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
