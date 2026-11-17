import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("correctness/no-array-index-as-key React payloads in inline text leaves", () => {
  it("flags an explicitly JSX-bearing item field and leaves a string field alone", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import { type ReactNode } from "react";
function Dynamic({ rows }: { rows: { view: ReactNode; text: string }[] }) {
  return rows.map((row, index) => <span key={index}>{row.view}</span>);
}
function Text({ rows }: { rows: { view: ReactNode; text: string }[] }) {
  return rows.map((row, index) => <span key={index}>{row.text}</span>);
}`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([3]);
  });

  it("resolves aliased named and namespace React type imports", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import type { ReactNode as Content } from "react";
import type * as ReactTypes from "react";
function Named({ rows: entries }: { rows: { view: Content }[] }) {
  return entries.map((row, index) => <span key={index}>{row.view}</span>);
}
function Qualified({ rows }: { rows: { view: ReactTypes.ReactElement }[] }) {
  return rows.map((row, index) => <span key={index}>{row.view}</span>);
}`,
      { includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([4, 7]);
  });

  it("keeps unrelated types, generic shadows and non-child uses outside the proof", () => {
    const result = runRule(
      noArrayIndexAsKey,
      `import type { ReactNode as Content } from "react";
import type * as Other from "./other";
type ReactNode = string;
function Local({ rows }: { rows: { view: ReactNode }[] }) {
  return rows.map((row, index) => <span key={index}>{row.view}</span>);
}
function Generic<Content extends string>({ rows }: { rows: { view: Content }[] }) {
  return rows.map((row, index) => <span key={index}>{row.view}</span>);
}
function OtherProvider({ rows }: { rows: { view: Other.ReactNode }[] }) {
  return rows.map((row, index) => <span key={index}>{row.view}</span>);
}
function Attribute({ rows }: { rows: { view: Content; text: string }[] }) {
  return rows.map((row, index) => <span key={index} data-view={row.view}>{row.text}</span>);
}
function Unknown({ rows }: { rows: { view: unknown }[] }) {
  return rows.map((row, index) => <span key={index}>{row.view}</span>);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
