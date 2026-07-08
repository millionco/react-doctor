import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlNoInvalidTableNesting } from "./html-no-invalid-table-nesting.js";

describe("correctness/html-no-invalid-table-nesting — regressions", () => {
  // docs-validation 2026-07 (eBay calendar): a `<td>` built inside a map
  // callback's statements and PUSHED into an array is rendered later via
  // `<tr>{columns}</tr>` — the lexical ancestor (`<tbody>`) is not the
  // runtime parent, so the walk must treat the detour through
  // `columns.push(...)` as opaque.
  it("stays silent on a td pushed into an array inside a map callback (ebay calendar shape)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Calendar = ({ rows }) => (
        <table>
          <tbody>
            {rows.map((row) => {
              const columns = [];
              columns.push(<td key="pre-column" colSpan={2} />);
              for (const day of row.days) {
                columns.push(<td key={day}>{day}</td>);
              }
              return <tr key={row.id}>{columns}</tr>;
            })}
          </tbody>
        </table>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a table element bound to a variable before rendering", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Grid = ({ items }) => (
        <table>
          <tbody>
            {items.map((item) => {
              const cell = <td>{item.label}</td>;
              return <tr key={item.id}>{cell}</tr>;
            })}
          </tbody>
        </table>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The map callback's RETURN still flows straight into the container,
  // so a genuinely misplaced element keeps firing.
  it("still flags a td returned directly under tbody from a map callback", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = ({ rows }) => (
        <table>
          <tbody>
            {rows.map((row) => <td key={row.id}>{row.label}</td>)}
          </tbody>
        </table>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("`<td>`"))).toBe(true);
  });

  it("still flags a td returned from a block-bodied map callback under tbody", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = ({ rows }) => (
        <table>
          <tbody>
            {rows.map((row) => {
              return <td key={row.id}>{row.label}</td>;
            })}
          </tbody>
        </table>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("`<td>`"))).toBe(true);
  });

  // docs-validation 2026-07 (cloudscape resizer-lookup tests): unit tests
  // deliberately render minimal invalid fixtures (`<table><th>`, a bare
  // `<div><th>`) to probe null paths — meaningless to flag.
  it("stays silent in test files", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      test("returns null when there is no table", () => {
        render(
          <div>
            <th>resize me</th>
          </div>,
        );
      });
      `,
      { filename: "src/table/resizer/__tests__/resizer-lookup.test.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags invalid nesting in production files", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = () => (
        <table>
          <th>resize me</th>
        </table>
      );
      `,
      { filename: "src/table/resizer/resizer.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("`<th>`"))).toBe(true);
  });
});
