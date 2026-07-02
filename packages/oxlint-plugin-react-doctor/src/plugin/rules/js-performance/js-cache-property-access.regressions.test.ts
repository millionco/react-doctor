import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCachePropertyAccess } from "./js-cache-property-access.js";

describe("js-performance/js-cache-property-access — regressions", () => {
  it("stays silent when the deep chain is mutated inside the loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `function f(state, results, n) { for (let i = 0; i < n; i++) { state.counter.value = state.counter.value + 1; results.push(state.counter.value); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a read-only deep chain repeated in the loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `function f(state, results, n) { for (let i = 0; i < n; i++) { results.push(state.counter.value); results.push(state.counter.value); results.push(state.counter.value); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the chain base is reassigned mid-loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `function f(start) { let node = start; while (node) { process(node.data.value); process(node.data.value); node = node.next; process(node.data.value); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a `this.props` chain read three times in a JSX render loop (bench anchor)", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `
class Calendar extends Component {
  renderMonths = () => {
    const monthList = [];
    for (let i = 0; i < monthsShown; ++i) {
      const monthDate = subMonths(this.state.date, i);
      monthList.push(
        <div key={i} className="react-datepicker__month-container">
          {this.props.monthHeaderPosition === "top" && this.renderHeader({ monthDate, i })}
          <Month
            monthHeader={
              this.props.monthHeaderPosition === "middle"
                ? this.renderHeader({ monthDate, i })
                : undefined
            }
            monthFooter={
              this.props.monthHeaderPosition === "bottom"
                ? this.renderHeader({ monthDate, i })
                : undefined
            }
          />
        </div>,
      );
    }
    return monthList;
  };
}
`,
      { filename: "calendar.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the repeated chain ends in the cheap `.length` intrinsic", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `
function summarize(issues, out) {
  for (const issue2 of issues) {
    if (issue2.path.length > 0) {
      out.push(issue2.path.length);
    } else if (issue2.path.length === 0) {
      out.push("root");
    }
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a mid-chain prefix is reassigned inside the loop", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `
function f(state, n, use, next) {
  for (let i = 0; i < n; i++) {
    use(state.counter.value);
    use(state.counter.value);
    state.counter = next(i);
    use(state.counter.value);
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags when an inner callback assigns to a param-shadowed same-named binding", () => {
    const result = runRule(
      jsCachePropertyAccess,
      `
function f(items, theme, render, fallback) {
  for (const item of items) {
    render(theme.colors.primary);
    render(theme.colors.primary);
    render(theme.colors.primary);
    item.onReset = (theme) => {
      theme = fallback();
      return theme;
    };
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
