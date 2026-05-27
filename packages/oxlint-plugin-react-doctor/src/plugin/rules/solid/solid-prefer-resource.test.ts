import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidPreferResource } from "./solid-prefer-resource.js";

describe("solid-prefer-resource", () => {
  it("flags async createEffect with fetch and setter", () => {
    const result = runRule(
      solidPreferResource,
      `import { createEffect } from "solid-js";
       createEffect(async () => {
         const res = await fetch("/api/data");
         setData(await res.json());
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("createResource");
  });

  it("flags createEffect containing fetch with setter at same level", () => {
    const result = runRule(
      solidPreferResource,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         const res = fetch("/api");
         setLoading(true);
       });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag createEffect without fetch", () => {
    const result = runRule(
      solidPreferResource,
      `import { createEffect } from "solid-js";
       createEffect(() => {
         setCount(value() + 1);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag async createEffect without setter", () => {
    const result = runRule(
      solidPreferResource,
      `import { createEffect } from "solid-js";
       createEffect(async () => {
         await fetch("/api/ping");
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag async createEffect without fetch", () => {
    const result = runRule(
      solidPreferResource,
      `import { createEffect } from "solid-js";
       createEffect(async () => {
         const data = await computeAsync();
         setResult(data);
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag without Solid import", () => {
    const result = runRule(
      solidPreferResource,
      `createEffect(async () => {
         const res = await fetch("/api");
         setData(await res.json());
       });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
