import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlNoInvalidTableNesting } from "./html-no-invalid-table-nesting.js";

describe("html-no-invalid-table-nesting", () => {
  it("flags `<table>` directly inside another `<table>`", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = () => (
        <table>
          <tbody>
            <tr>
              <table><tbody><tr><td>x</td></tr></tbody></table>
            </tr>
          </tbody>
        </table>
      );
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((d) => d.message.includes("`<table>` cannot be a direct"))).toBe(
      true,
    );
  });

  it("does NOT flag a `<table>` nested inside a `<th>` (legal HTML, same as `<td>`)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Header = () => (
        <table>
          <thead>
            <tr>
              <th>
                <table><tbody><tr><td>filter</td></tr></tbody></table>
              </th>
            </tr>
          </thead>
        </table>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a `<table>` nested inside a `<td>` (legal HTML)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Nested = () => (
        <table>
          <tbody>
            <tr>
              <td>
                <table><tbody><tr><td>inner</td></tr></tbody></table>
              </td>
            </tr>
          </tbody>
        </table>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags `<thead>` whose nearest host ancestor is not `<table>`", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = () => (
        <div>
          <thead><tr><th>x</th></tr></thead>
        </div>
      );
      `,
    );

    expect(result.diagnostics.some((d) => d.message.includes("`<thead>`"))).toBe(true);
  });

  it("flags `<tr>` directly inside a `<div>`", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = () => (
        <div>
          <tr><td>x</td></tr>
        </div>
      );
      `,
    );

    expect(result.diagnostics.some((d) => d.message.includes("`<tr>`"))).toBe(true);
  });

  it("flags `<td>` directly inside a `<table>` (skipping `<tr>`)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = () => (
        <table>
          <td>x</td>
        </table>
      );
      `,
    );

    expect(result.diagnostics.some((d) => d.message.includes("`<td>`"))).toBe(true);
  });

  it("flags `<th>` directly inside a `<thead>` (skipping `<tr>`)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Bad = () => (
        <table>
          <thead>
            <th>x</th>
          </thead>
        </table>
      );
      `,
    );

    expect(result.diagnostics.some((d) => d.message.includes("`<th>`"))).toBe(true);
  });

  it("does not flag a well-formed table with a row group", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Good = () => (
        <table>
          <thead>
            <tr><th>name</th></tr>
          </thead>
          <tbody>
            <tr><td>Ada</td></tr>
          </tbody>
        </table>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `<tr>` directly inside `<table>` (browsers auto-insert `<tbody>`)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const TerseTable = () => (
        <table>
          <tr><td>Ada</td></tr>
        </table>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag table elements when their parent is a custom component (opaque)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Row = () => (
        <TableBody>
          <tr><td>x</td></tr>
        </TableBody>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag table elements when the host ancestor is a member-expression component (`<Foo.Bar>`)", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Page = () => (
        <Table.Body>
          <tr><td>x</td></tr>
        </Table.Body>
      );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a top-level table fragment with no host ancestor", () => {
    const result = runRule(
      htmlNoInvalidTableNesting,
      `
      const Cell = () => <td>just-the-cell</td>;
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
