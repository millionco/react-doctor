import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

describe("no-array-index-as-key native parity regressions", () => {
  it.each([
    { key: "`${i}_${idx}`", name: "i" },
    { key: "`${idx}_${i}`", name: "idx" },
  ])("uses the first index candidate in $key", ({ key, name }) => {
    const result = runRule(
      noArrayIndexAsKey,
      `export const List = ({ rows }) => rows.map((row, i) => row.values.map((value, idx) => <Item key={${key}} value={value} />));`,
      { filename: "src/component.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe(
      `Your users can see & submit the wrong data when this list reorders or filters, so use a stable id like \`key={item.id}\`, not the array index "${name}".`,
    );
  });
  it.each([
    {
      name: "block-row-destructured-item-composite-key",
      source:
        "export const List = ({ items }) => <div>{items.map(({ name }, index) => <p key={`${name}-${index}`}>{name}</p>)}</div>;",
      expectedCount: 0,
    },
    {
      name: "block-row-primitive-item-composite-key",
      source:
        "export const List = ({ items }) => <div>{items.map((name, index) => <p key={`${name}-${index}`}>{name}</p>)}</div>;",
      expectedCount: 0,
    },
    {
      name: "block-row-bare-index-control",
      source:
        "export const List = ({ items }) => <div>{items.map(({ name }, index) => <p key={index}>{name}</p>)}</div>;",
      expectedCount: 1,
    },
    {
      name: "block-row-composite-key-stateful-control",
      source:
        "export const List = ({ items }) => <div>{items.map(({ name }, index) => <p key={`${name}-${index}`}><input defaultValue={name} /></p>)}</div>;",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(noArrayIndexAsKey, source, { filename: "src/component.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
