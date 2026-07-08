import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxMaxDepth } from "./jsx-max-depth.js";

const MAX_TWO_SETTINGS = { "react-doctor": { jsxMaxDepth: { max: 2 } } };

// Production FP sweep: one over-deep tree has MANY over-deep leaves
// (every sibling under the deep branch fires), so per-leaf reporting
// produced 10-40 diagnostics for a single root cause — provider stacks
// and deep form trees were the dominant shapes. Reports are deduped to
// one per outermost JSX tree, keeping the deepest offending leaf.
describe("react-builtins/jsx-max-depth — regressions", () => {
  it("reports a single diagnostic for many over-deep sibling leaves in one tree", () => {
    const providerStack = `
      const App = () => (
        <ThemeProvider>
          <PortalProvider>
            <NavigationContainer>
              <Toasts />
              <Airplay />
              <RootScreen />
              <Drawers />
            </NavigationContainer>
          </PortalProvider>
        </ThemeProvider>
      );
    `;
    const result = runRule(jsxMaxDepth, providerStack, { settings: MAX_TWO_SETTINGS });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the deepest leaf's depth in the deduped diagnostic", () => {
    const unevenTree = `
      const Page = () => (
        <div>
          <section>
            <ul>
              <li>
                <span />
              </li>
            </ul>
            <aside />
          </section>
        </div>
      );
    `;
    const result = runRule(jsxMaxDepth, unevenTree, { settings: MAX_TWO_SETTINGS });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.message).toContain("4 levels deep");
  });

  it("still reports each over-deep tree separately", () => {
    const twoTrees = `
      const First = () => (
        <div><section><ul><li /></ul></section></div>
      );
      const Second = () => (
        <main><article><ol><li /></ol></article></main>
      );
    `;
    const result = runRule(jsxMaxDepth, twoTrees, { settings: MAX_TWO_SETTINGS });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not report trees within the limit", () => {
    const shallowTree = `
      const Card = () => (
        <div><span /></div>
      );
    `;
    const result = runRule(jsxMaxDepth, shallowTree, { settings: MAX_TWO_SETTINGS });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
