import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPreventDefault } from "./no-prevent-default.js";

describe("correctness/no-prevent-default — regressions", () => {
  it("stays silent on a progressively-enhanced form with a native action", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() { return <form action="/submit" method="post" onSubmit={(e) => { e.preventDefault(); clientSubmit(); }}><button>Go</button></form>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an action-less form whose handler only does local work", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() { return <form onSubmit={(e) => { e.preventDefault(); setOpen(true); }}><button>Go</button></form>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on the ant-design dropdown trigger anchor in a demo file (test-noise)", () => {
    const result = runRule(
      noPreventDefault,
      `export default function App() {
        return (
          <Dropdown menu={{ items }}>
            <a onClick={(e) => e.preventDefault()}>
              <Space>Hover me</Space>
            </a>
          </Dropdown>
        );
      }`,
      { filename: "components/dropdown/demo/basic.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the same anchor in a __tests__ file (test-noise)", () => {
    const result = runRule(
      noPreventDefault,
      `export default function App() { return <a onClick={(e) => e.preventDefault()}>Hover me</a>; }`,
      { filename: "components/dropdown/__tests__/index.test.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a bare preventDefault anchor in a production file", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() { return <a onClick={(e) => e.preventDefault()}>Hover me</a>; }`,
      { filename: "src/app.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a dead link whose handler only tracks analytics", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() {
        return <a href="/pricing" onClick={(e) => { e.preventDefault(); analytics.track("clicked"); }}>Pricing</a>;
      }`,
      { filename: "src/app.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a dead link whose handler only logs", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() {
        return <a href="#" onClick={(e) => { e.preventDefault(); console.log("clicked"); }}>Go</a>;
      }`,
      { filename: "src/app.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on an anchor whose handler pushes through the router", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() {
        return <a href="/pricing" onClick={(e) => { e.preventDefault(); router.push("/pricing"); }}>Pricing</a>;
      }`,
      { filename: "src/app.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an anchor whose handler calls a navigate-shaped function", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() {
        return <a href="/pricing" onClick={(e) => { e.preventDefault(); navigate("/pricing"); }}>Pricing</a>;
      }`,
      { filename: "src/app.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an anchor whose handler opens through window", () => {
    const result = runRule(
      noPreventDefault,
      `export default function C() {
        return <a href="/docs" onClick={(e) => { e.preventDefault(); window.open("/docs", "_blank"); }}>Docs</a>;
      }`,
      { filename: "src/app.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an anchor delegating to a component prop handler", () => {
    const result = runRule(
      noPreventDefault,
      `export default function LinkButton({ href, onNavigate }) {
        return <a href={href} onClick={(e) => { e.preventDefault(); onNavigate(href); }}>Go</a>;
      }`,
      { filename: "src/link-button.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
