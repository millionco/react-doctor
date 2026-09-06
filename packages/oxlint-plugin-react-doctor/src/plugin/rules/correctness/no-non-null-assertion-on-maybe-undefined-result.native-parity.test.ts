import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

describe("no-non-null-assertion-on-maybe-undefined-result native parity regressions", () => {
  it.each([
    {
      name: "ensure-map-member-key-for-of-const",
      source:
        "const grouped = new Map<string, string[]>(); for (const item of items) { if (!grouped.has(item.group)) grouped.set(item.group, []); grouped.get(item.group)!.push('value'); }",
      expectedCount: 0,
    },
    {
      name: "ensure-map-member-key-local-const-control",
      source:
        "const grouped = new Map<string, string[]>(); const item = getItem(); if (!grouped.has(item.group)) grouped.set(item.group, []); grouped.get(item.group)!.push('value');",
      expectedCount: 1,
    },
    {
      name: "ensure-map-member-key-for-of-let-control",
      source:
        "const grouped = new Map<string, string[]>(); for (let item of items) { if (!grouped.has(item.group)) grouped.set(item.group, []); grouped.get(item.group)!.push('value'); }",
      expectedCount: 1,
    },
    {
      name: "ensure-map-member-key-for-of-invalidation-control",
      source:
        "const grouped = new Map<string, string[]>(); for (const item of items) { if (!grouped.has(item.group)) grouped.set(item.group, []); grouped.delete(item.group); grouped.get(item.group)!.push('value'); }",
      expectedCount: 1,
    },
  ])("$name", ({ source, expectedCount }) => {
    const result = runRule(noNonNullAssertionOnMaybeUndefinedResult, source, {
      filename: "src/component.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
