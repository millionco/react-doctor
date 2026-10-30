import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";
import { noDerivedState } from "./no-derived-state.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { isNativeViewportStateWithMountSnapshot } from "./utils/is-native-viewport-state-with-mount-snapshot.js";

interface ViewportFixtureOptions {
  imports?: string;
  sampler?: string;
  snapshot?: string;
  cleanup?: string;
  beforeMount?: string;
  setupPrefix?: string;
  setupSuffix?: string;
  dependencies?: string;
  moduleWork?: string;
  visibility?: string;
  visibilityDependencies?: string;
}

const buildViewportFixture = ({
  imports = 'import { useEffect, useMemo, useRef, useState } from "react";',
  sampler = `const width = window.innerWidth;
    const height = window.innerHeight;
    setDimensions({ width, height });`,
  snapshot = `const width = window.innerWidth;
    const height = window.innerHeight;
    setDimensions({ width, height });`,
  cleanup = 'window.removeEventListener("resize", onViewportResize);',
  beforeMount = "",
  setupPrefix = "",
  setupSuffix = "",
  dependencies = "[]",
  moduleWork = "",
  visibility = "const visible = enabled && wideEnough;",
  visibilityDependencies = "[visible]",
}: ViewportFixtureOptions = {}): string => `
  ${imports}
  ${moduleWork}
  export const ResponsiveChoices = ({ enabled, limit, ...attributes }) => {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [visibleItems, setVisibleItems] = useState([]);
    const [activeRow, setActiveRow] = useState(0);
    const epochRef = useRef(0);
    const wideEnough = useMemo(() => dimensions.width > limit, [dimensions, limit]);
    ${visibility}
    const onViewportResize = () => { ${sampler} };
    ${beforeMount}
    useEffect(() => {
      ${setupPrefix}
      window.addEventListener("resize", onViewportResize);
      ${snapshot}
      ${setupSuffix}
      return () => { ${cleanup} };
    }, ${dependencies});
    useEffect(() => {
      if (!visible) {
        epochRef.current += 1;
        setActiveRow(0);
        setVisibleItems([]);
      }
    }, ${visibilityDependencies});
    return <output {...attributes}>{visible ? visibleItems[activeRow] : null}</output>;
  };
`;

describe("no-chain native viewport mount snapshot", () => {
  it("accepts ordinary string conversion of an unrelated computed value", () => {
    const code = buildViewportFixture({
      moduleWork:
        'const acquired = (() => 0)["con" + "structor"]; const text = `value:${acquired}`;',
    });
    const result = runRule(noChainStateUpdates, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "an acquired callable passed to a template tag",
      buildViewportFixture({
        moduleWork: 'const acquired = (() => 0)["con" + "structor"]; consume`value:${acquired}`;',
      }),
    ],
    [
      "parent-owned state",
      buildViewportFixture()
        .replace(
          "const onViewportResize = () => {",
          "const Child = () => { const onViewportResize = () => {",
        )
        .replace("}, []);", "}, []); return null; };"),
    ],
    [
      "a callback alias before initialization",
      buildViewportFixture()
        .replace(
          "useEffect(() => {",
          "useEffect(installViewport, []); const installViewport = () => {",
        )
        .replace("}, []);", "};"),
    ],
    [
      "an acquired callable alias",
      buildViewportFixture({
        moduleWork:
          'const assembledKey = "con" + "structor"; const acquired = (() => 0)[assembledKey]; const forwarded = acquired; forwarded("return 1");',
      }),
    ],
    [
      "an acquired constructor alias",
      buildViewportFixture({
        moduleWork: 'const acquired = (() => 0)["con" + "structor"]; new acquired("return 1");',
      }),
    ],
    [
      "an acquired callable stored in an object",
      buildViewportFixture({
        moduleWork:
          'const acquired = (() => 0)["con" + "structor"]; const stored = { factory: acquired };',
      }),
    ],
    [
      "an acquired callable stored on a member",
      buildViewportFixture({
        moduleWork: 'const acquired = (() => 0)["con" + "structor"]; holder.factory = acquired;',
      }),
    ],
    [
      "an acquired callable passed to an unknown helper",
      buildViewportFixture({
        moduleWork: 'const acquired = (() => 0)["con" + "structor"]; consume(acquired);',
      }),
    ],
    [
      "an acquired callable returned by a function",
      buildViewportFixture({
        moduleWork:
          'const acquired = (() => 0)["con" + "structor"]; const deliver = () => acquired;',
      }),
    ],
  ])("declines the direct certificate for %s", (_label, code) => {
    const certificates: boolean[] = [];
    const probe: Rule = {
      ...noChainStateUpdates,
      create: (context) => ({
        VariableDeclarator: (node) => {
          if (
            isNodeOfType(node, "VariableDeclarator") &&
            isNodeOfType(node.id, "ArrayPattern") &&
            isNodeOfType(node.id.elements[0], "Identifier") &&
            node.id.elements[0].name === "dimensions"
          ) {
            certificates.push(isNativeViewportStateWithMountSnapshot(node, context));
          }
        },
      }),
    };
    expect(runRule(probe, code).parseErrors).toEqual([]);
    expect(certificates).toEqual([false]);
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.map((diagnostic) => code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim()),
    ).toContain("setVisibleItems([]);");
  });

  it("accepts the closed scalar form as a secondary case", () => {
    const code = buildViewportFixture({
      sampler: "setDimensions(window.innerWidth);",
      snapshot: "setDimensions(window.innerWidth);",
    })
      .replace("useState({ width: 0, height: 0 })", "useState(0)")
      .replace("dimensions.width > limit", "dimensions > limit");
    const result = runRule(noChainStateUpdates, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a readonly native alias chain",
      {
        snapshot:
          "const reading = window.innerWidth; const width = reading; const height = window.innerHeight; setDimensions({ width, height });",
      },
    ],
    [
      "transparent native receiver wrappers",
      {
        snapshot:
          "const width = (window as Window).innerWidth; const height = window!.innerHeight; setDimensions({ width, height });",
      },
    ],
    [
      "type-only React namespace uses and unrelated data indexing",
      {
        imports:
          'import * as React from "react"; import { useEffect, useMemo, useRef, useState } from "react";',
        moduleWork:
          "interface InputShape { onInput: (event: React.FormEvent<HTMLInputElement>) => void; } const hasItem = (items, index) => !!items[index];",
      },
    ],
  ])("accepts source-compatible %s", (_label, options) => {
    const result = runRule(noChainStateUpdates, buildViewportFixture(options));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a wrapped callback", "useEffect((() => {", "}) as (() => void), []);"],
    [
      "a wrapped callback alias",
      "const installViewport = () => {",
      "}; useEffect((installViewport as (() => void)), []);",
    ],
    ["a discarded effect return", "void useEffect(() => {", "}, []);"],
  ])("accepts %s", (_label, opening, closing) => {
    const code = buildViewportFixture()
      .replace("useEffect(() => {", opening)
      .replace("}, []);", closing);
    const result = runRule(noChainStateUpdates, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("declines conditional mount registration", () => {
    const code = buildViewportFixture().replace(
      "useEffect(() => {",
      "if (enabled) useEffect(() => {",
    );
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.map((diagnostic) => code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim()),
    ).toContain("setVisibleItems([]);");
  });

  it("declines observe escapes without repairing legacy observer preemption", () => {
    const code = buildViewportFixture()
      .replace("useEffect(() => {", "const installViewport = () => {")
      .replace("}, []);", "}; observe(installViewport); useEffect(installViewport, []);");
    const certificates: boolean[] = [];
    const probe: Rule = {
      ...noChainStateUpdates,
      create: (context) => ({
        VariableDeclarator: (node) => {
          if (
            isNodeOfType(node, "VariableDeclarator") &&
            isNodeOfType(node.id, "ArrayPattern") &&
            isNodeOfType(node.id.elements[0], "Identifier") &&
            node.id.elements[0].name === "dimensions"
          ) {
            certificates.push(isNativeViewportStateWithMountSnapshot(node, context));
          }
        },
      }),
    };
    expect(runRule(probe, code).parseErrors).toEqual([]);
    expect(certificates).toEqual([false]);
    expect(runRule(noChainStateUpdates, code).diagnostics).toEqual([]);
  });

  it.each([1, 8])(
    "caches provider and repeated state certificates across %i components",
    (count) => {
      let providerScans = 0;
      const stateBindingReads = new Map<EsTreeNode, number>();
      const countedRule: Rule = {
        ...noChainStateUpdates,
        create: (context) => {
          const scopes = context.scopes;
          const countedScopes: ScopeAnalysis = {
            ...scopes,
            isGlobalReference: (identifier) => {
              if (isNodeOfType(identifier, "Identifier") && identifier.name === "Boolean")
                providerScans += 1;
              return scopes.isGlobalReference(identifier);
            },
            symbolFor: (identifier) => {
              if (
                isNodeOfType(identifier, "Identifier") &&
                identifier.name === "dimensions" &&
                isNodeOfType(identifier.parent, "ArrayPattern") &&
                identifier.parent.elements[0] === identifier
              ) {
                stateBindingReads.set(identifier, (stateBindingReads.get(identifier) ?? 0) + 1);
              }
              return scopes.symbolFor(identifier);
            },
          };
          return noChainStateUpdates.create({ ...context, scopes: countedScopes });
        },
      };
      const components = Array.from({ length: count }, (_, index) =>
        buildViewportFixture()
          .replace('import { useEffect, useMemo, useRef, useState } from "react";', "")
          .replace("ResponsiveChoices", `ResponsiveChoices${index}`)
          .replace(
            "return <output",
            `useEffect(() => { if (!visible) setVisibleItems([]); }, [visible]); return <output`,
          ),
      );
      const code = `import { useEffect, useMemo, useRef, useState } from "react";
      const marker = Boolean(1); ${components.join("\n")}`;
      const result = runRule(countedRule, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(providerScans).toBe(1);
      expect(stateBindingReads.size).toBe(count);
      expect([...stateBindingReads.values()]).toEqual(Array.from({ length: count }, () => 1));
    },
  );

  it.each([
    ["an escaped alias", "consume(installViewport); useEffect(installViewport, []);"],
    ["a replaced alias", "installViewport = replacement; useEffect(installViewport, []);"],
    ["an invoked alias", "installViewport(); useEffect(installViewport, []);"],
    ["a stored alias", "holder.install = installViewport; useEffect(installViewport, []);"],
  ])("declines a mount callback with %s", (_label, registration) => {
    const code = buildViewportFixture()
      .replace("useEffect(() => {", "const installViewport = () => {")
      .replace("}, []);", `}; ${registration}`);
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.map((diagnostic) => code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim()),
    ).toContain("setVisibleItems([]);");
  });

  it.each(["if (again) inner();", "observe(inner);"])(
    "declines an inner named callback with %s",
    (prefix) => {
      const code = buildViewportFixture().replace(
        "useEffect(() => {",
        `useEffect(function inner() { ${prefix}`,
      );
      const result = runRule(noChainStateUpdates, code, { includeLocations: true });
      expect(result.parseErrors).toEqual([]);
      expect(
        result.diagnostics.map((diagnostic) =>
          code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim(),
        ),
      ).toContain("setVisibleItems([]);");
    },
  );

  it("keeps separate prop retirement diagnostics", () => {
    const code = buildViewportFixture().replace(
      "return <output",
      `
      useEffect(() => {
        if (!enabled) {
          setVisibleItems(["retired"]);
        }
      }, [enabled]);
      return <output`,
    );
    const result = runRule(noAdjustStateOnPropChange, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.map((diagnostic) => code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim()),
    ).toContain('setVisibleItems(["retired"]);');
  });

  it("keeps separate React-derived state diagnostics", () => {
    const code = buildViewportFixture({
      beforeMount: "const [revision, setRevision] = useState(0);",
    }).replace(
      "return <output",
      `
        useEffect(() => {
          setActiveRow(revision + 1);
        }, [revision]);
        return <output`,
    );
    const result = runRule(noDerivedState, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.map((diagnostic) => code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim()),
    ).toContain("setActiveRow(revision + 1);");
  });

  it("retains chains with a separate React-owned triggering state", () => {
    const code = buildViewportFixture({
      beforeMount: "const [revision, setRevision] = useState(0);",
      visibilityDependencies: "[visible, revision]",
    }).replace(
      "<output {...attributes}",
      "<output {...attributes} onClick={() => setRevision(revision + 1)}",
    );
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    const lines = result.diagnostics.map((diagnostic) =>
      code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim(),
    );
    expect(lines).toContain("setActiveRow(0);");
    expect(lines).toContain("setVisibleItems([]);");
  });

  it.each([
    ["a component-scoped record sampler", {}],
    [
      "unrelated bookkeeping after unsubscribe",
      { cleanup: 'window.removeEventListener("resize", onViewportResize); epochRef.current += 1;' },
    ],
    [
      "separate prop and viewport memo dependencies",
      {
        visibility: "const visible = enabled && wideEnough;",
        visibilityDependencies: "[enabled, wideEnough]",
      },
    ],
    [
      "direct native record fields",
      {
        sampler: "setDimensions({ width: window.innerWidth, height: window.innerHeight });",
        snapshot: "setDimensions({ height: window.innerHeight, width: window.innerWidth });",
      },
    ],
  ])("exempts the named downstream resets with %s", (_label, options) => {
    const code = buildViewportFixture(options);
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["() =>", "function ()"])(
    "accepts a single immutable %s mount callback alias",
    (callback) => {
      const code = buildViewportFixture()
        .replace("useEffect(() => {", `const installViewport = ${callback} {`)
        .replace("}, []);", "}; useEffect(installViewport, []);");
      const result = runRule(noChainStateUpdates, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    [
      "an extra React event writer",
      { beforeMount: "const press = () => setDimensions({ width: 1, height: 2 });" },
    ],
    ["a render writer", { beforeMount: "setDimensions({ width: 1, height: 2 });" }],
    ["an escaped setter", { beforeMount: "observe(setDimensions);" }],
    ["an aliased setter", { beforeMount: "const writeDimensions = setDimensions;" }],
    ["a replaced setter", { beforeMount: "setDimensions = replacement;" }],
    ["an escaped sampler", { beforeMount: "observe(onViewportResize);" }],
    ["a directly invoked sampler", { beforeMount: "onViewportResize();" }],
    ["a sampler property write", { beforeMount: "onViewportResize.extra = replacement;" }],
    ["a replaced sampler", { beforeMount: "onViewportResize = replacement;" }],
    ["a record-state escape", { beforeMount: "observe(dimensions);" }],
    ["a record-state mutation", { beforeMount: "dimensions.width = 123;" }],
    [
      "a prop-derived initial snapshot",
      { snapshot: "setDimensions({ width: limit, height: 0 });" },
    ],
    ["an opaque snapshot", { snapshot: "setDimensions(readDimensions());" }],
    ["a functional updater", { snapshot: "setDimensions(current => current);" }],
    [
      "a nonmatching dimension map",
      { snapshot: "setDimensions({ width: window.innerHeight, height: window.innerWidth });" },
    ],
    [
      "an accessor payload",
      {
        snapshot:
          "setDimensions({ get width() { return window.innerWidth; }, height: window.innerHeight });",
      },
    ],
    [
      "a spread payload",
      {
        snapshot:
          "setDimensions({ ...source, width: window.innerWidth, height: window.innerHeight });",
      },
    ],
    [
      "a dynamic payload key",
      { snapshot: "setDimensions({ [key]: window.innerWidth, height: window.innerHeight });" },
    ],
    [
      "a mutable dimension alias",
      {
        snapshot:
          "let width = window.innerWidth; const height = window.innerHeight; setDimensions({ width, height });",
      },
    ],
    [
      "an escaped dimension alias",
      {
        snapshot:
          "const width = window.innerWidth; const height = window.innerHeight; observe(width); setDimensions({ width, height });",
      },
    ],
    ["reactive mount dependencies", { dependencies: "[enabled]" }],
    ["a second snapshot writer", { setupSuffix: "setDimensions({ width: 0, height: 0 });" }],
    ["opaque setup work", { setupSuffix: "notify();" }],
    ["an early mount exit", { setupSuffix: "if (enabled) return;" }],
    ["a throwing mount exit", { setupSuffix: 'throw new Error("stop");' }],
    [
      "a resource lifetime",
      { setupPrefix: "using resource = { [Symbol.dispose]() { notify(); } };" },
    ],
    ["a missing unsubscribe", { cleanup: "epochRef.current += 1;" }],
    [
      "a different cleanup event",
      { cleanup: 'window.removeEventListener("scroll", onViewportResize);' },
    ],
    ["a different cleanup handler", { cleanup: 'window.removeEventListener("resize", other);' }],
    [
      "a conditional cleanup",
      { cleanup: 'if (enabled) window.removeEventListener("resize", onViewportResize);' },
    ],
    [
      "a pre-removal early return",
      { cleanup: 'if (enabled) return; window.removeEventListener("resize", onViewportResize);' },
    ],
    [
      "a pre-removal throw",
      {
        cleanup: 'throw new Error("stop"); window.removeEventListener("resize", onViewportResize);',
      },
    ],
    [
      "a pre-removal callback",
      { cleanup: 'notify(); window.removeEventListener("resize", onViewportResize);' },
    ],
    [
      "a selected writer in cleanup suffix",
      {
        cleanup:
          'window.removeEventListener("resize", onViewportResize); setDimensions({ width: 0, height: 0 });',
      },
    ],
    [
      "a sampler call in cleanup suffix",
      { cleanup: 'window.removeEventListener("resize", onViewportResize); onViewportResize();' },
    ],
    [
      "a selected state read in cleanup suffix",
      {
        cleanup:
          'window.removeEventListener("resize", onViewportResize); observe(dimensions.width);',
      },
    ],
    [
      "native re-registration in cleanup suffix",
      {
        cleanup:
          'window.removeEventListener("resize", onViewportResize); window.addEventListener("resize", onViewportResize);',
      },
    ],
    [
      "native mutation in cleanup suffix",
      { cleanup: 'window.removeEventListener("resize", onViewportResize); window.innerWidth = 0;' },
    ],
    ["a shadowed native receiver", { beforeMount: "const window = source;" }],
    ["a replaced native listener", { moduleWork: "window.addEventListener = replacement;" }],
    ["a replaced native dimension", { moduleWork: "window.innerWidth = 0;" }],
    [
      "reflective native replacement",
      { moduleWork: 'Object.defineProperty(window, "innerWidth", { get: replacement });' },
    ],
    ["an escaped native receiver", { moduleWork: "observe(window);" }],
    ["a global receiver alias", { moduleWork: "const surface = window; surface.innerWidth = 0;" }],
    ["an explicit global namespace alias", { moduleWork: "globalThis.window.innerWidth = 0;" }],
    [
      "a listener alias mutation",
      { moduleWork: "const listen = window.addEventListener; listen.extra = replacement;" },
    ],
    [
      "a destructured native constructor",
      { moduleWork: "const { constructor: make } = []; make.extra = replacement;" },
    ],
    [
      "a computed native constructor",
      { moduleWork: 'const make = []["constructor"]; make.extra = replacement;' },
    ],
    [
      "a constant-key native constructor",
      { moduleWork: 'const key = "constructor"; const make = [][key]; make.extra = replacement;' },
    ],
    [
      "a wrapped-key native constructor",
      { moduleWork: 'const make = [][("constructor" as string)]; make.extra = replacement;' },
    ],
    [
      "a template-key native constructor",
      { moduleWork: "const make = [][`constructor`]; make.extra = replacement;" },
    ],
    ["a wrapped provider assignment", { moduleWork: "(window.innerWidth as number) = 0;" }],
    ["a dynamic property assignment", { moduleWork: "surface[key] = replacement;" }],
    [
      "a later initialized dimension alias",
      {
        snapshot:
          "const width = later; const later = window.innerWidth; const height = window.innerHeight; setDimensions({ width, height });",
      },
    ],
    [
      "an unconsumed native dimension alias",
      {
        snapshot:
          "const unused = window.innerWidth; const width = window.innerWidth; const height = window.innerHeight; setDimensions({ width, height });",
      },
    ],
    [
      "an erased React import",
      { imports: 'import type { useEffect, useMemo, useRef, useState } from "react";' },
    ],
    ["a replaced React provider", { moduleWork: "useState = replacement;" }],
    [
      "a mutable React namespace",
      {
        imports: 'import React, { useEffect, useMemo, useRef, useState } from "react";',
        moduleWork: "React.useState = replacement;",
      },
    ],
    [
      "runtime namespace provider mutation",
      { moduleWork: "namespace Setup { window.innerWidth = 0; }" },
    ],
    [
      "runtime enum provider mutation",
      { moduleWork: "enum Setup { Changed = (window.innerWidth = 0, 1) }" },
    ],
  ])("retains both downstream warnings for %s", (_label, options) => {
    const code = buildViewportFixture(options);
    const result = runRule(noChainStateUpdates, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    const targetLines = result.diagnostics.map((diagnostic) =>
      code.split("\n")[(diagnostic.line ?? 0) - 1]?.trim(),
    );
    expect(targetLines).toContain("setActiveRow(0);");
    expect(targetLines).toContain("setVisibleItems([]);");
  });
});
