import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropTypes } from "./no-prop-types.js";

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(noPropTypes, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("architecture/no-prop-types component provenance", () => {
  it("ignores an uppercase validation object", () => {
    expectDiagnosticCount(
      `export const Schema = { propTypes: {} as Record<string, (value: unknown) => boolean> };
       Schema.propTypes = { value: (value: unknown): boolean => typeof value === "string" };`,
      0,
    );
  });

  it("reports propTypes assignments on local function components", () => {
    expectDiagnosticCount(
      `export const Panel = (props: { value: string }) => <div>{props.value}</div>;
       Panel.propTypes = { value: (value: unknown): boolean => typeof value === "string" };
       export function Dialog(props: { value: string }) { return <div>{props.value}</div>; }
       Dialog.propTypes = { value: (value: unknown): boolean => typeof value === "string" };`,
      2,
    );
  });

  it("ignores uppercase functions without React render output", () => {
    expectDiagnosticCount(
      `const Schema = (value: unknown): boolean => typeof value === "string";
       Schema.propTypes = { value: Schema };`,
      0,
    );
  });
});
