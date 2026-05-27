import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidImports } from "./solid-imports.js";

describe("solid-imports", () => {
  it("allows createSignal imported from solid-js", () => {
    const result = runRule(solidImports, `import { createSignal } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows render imported from solid-js/web", () => {
    const result = runRule(solidImports, `import { render } from "solid-js/web";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows createStore imported from solid-js/store", () => {
    const result = runRule(solidImports, `import { createStore } from "solid-js/store";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags render imported from solid-js instead of solid-js/web", () => {
    const result = runRule(solidImports, `import { render } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js/web");
  });

  it("flags createStore imported from solid-js instead of solid-js/store", () => {
    const result = runRule(solidImports, `import { createStore } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js/store");
  });

  it("flags Portal imported from solid-js instead of solid-js/web", () => {
    const result = runRule(solidImports, `import { Portal } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js/web");
  });

  it("flags type Component imported from solid-js/store instead of solid-js", () => {
    const result = runRule(solidImports, `import type { Component } from "solid-js/store";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js");
  });

  it("flags type StoreNode imported from solid-js instead of solid-js/store", () => {
    const result = runRule(solidImports, `import type { StoreNode } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js/store");
  });

  it("ignores non-solid imports entirely", () => {
    const result = runRule(solidImports, `import { useState } from "react";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple wrong imports in the same declaration", () => {
    const result = runRule(solidImports, `import { render, Portal } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows unknown specifiers without flagging", () => {
    const result = runRule(solidImports, `import { somethingCustom } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags produce imported from solid-js instead of solid-js/store", () => {
    const result = runRule(solidImports, `import { produce } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js/store");
  });

  it("flags createStore from solid-js while allowing createSignal on same line", () => {
    const result = runRule(solidImports, `import { createSignal, createStore } from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("solid-js/store");
  });

  it("does not flag default import from solid-js", () => {
    const result = runRule(solidImports, `import solid from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag namespace import from solid-js", () => {
    const result = runRule(solidImports, `import * as solid from "solid-js";`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
