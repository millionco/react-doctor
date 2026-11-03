import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const buildDeclaredListenerFixture = (
  declaration: string,
  beforeEffect = "",
  cleanup = "return () => { unsubscribe(); };",
): string => `import { useEffect } from "react";
  ${declaration}
  export const Screen = () => {
    const coveredNavigation = useNavigation();
    ${beforeEffect}
    useEffect(() => {
      const unsubscribe = coveredNavigation.addListener("transitionEnd", () => {});
      ${cleanup}
    }, [coveredNavigation]);
    return null;
  };`;

const declaredNavigation = `interface Navigation {
  addListener: (event: string, callback: () => void) => () => void;
}
declare function useNavigation(): Navigation;`;

describe.each([
  { name: "direct", rule: effectNeedsCleanup },
  { name: "host semantic context", rule: wrapWithSemanticContext(effectNeedsCleanup) },
])("effect-needs-cleanup issue #1956 ($name)", ({ rule }) => {
  it.each(["coveredNavigation", "navigation"])(
    "accepts the public declared hook reproduction with receiver %s",
    (receiverName) => {
      const result = runRule(
        rule,
        `import { useEffect } from "react";
        interface Navigation {
          addListener: (type: "transitionEnd", callback: () => void) => () => void;
        }
        declare function useNavigation(): Navigation;
        export const Screen = () => {
          const ${receiverName} = useNavigation();
          useEffect(() => {
            const unsubscribe = ${receiverName}.addListener("transitionEnd", () => {});
            return () => { unsubscribe(); };
          }, [${receiverName}]);
          return null;
        };`,
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    [
      "type alias",
      "type Navigation = { addListener: (event: string, callback: () => void) => () => void; }; declare function useNavigation(): Navigation;",
    ],
    [
      "method signature",
      "interface Navigation { addListener(event: string, callback: () => void): () => void; } declare function useNavigation(): Navigation;",
    ],
    [
      "inline return",
      "declare function useNavigation(): { addListener: (event: string, callback: () => void) => () => void; };",
    ],
    [
      "quoted property",
      'interface Navigation { "addListener": (event: string, callback: () => void) => () => void; } declare function useNavigation(): Navigation;',
    ],
    [
      "provider type alias chain",
      "interface ListenerProvider { addListener: (event: string, callback: () => void) => () => void; } type Navigation = ListenerProvider; declare function useNavigation(): Navigation;",
    ],
  ])("accepts a declared callable %s contract", (_, declaration) => {
    const result = runRule(rule, buildDeclaredListenerFixture(declaration));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts returning the typed unsubscribe handle directly", () => {
    const result = runRule(
      rule,
      buildDeclaredListenerFixture(declaredNavigation, "", "return unsubscribe;"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    { providerType: "null", expectedDiagnostics: 1 },
    { providerType: "undefined", expectedDiagnostics: 0 },
  ])(
    "keeps the $providerType provider union boundary explicit",
    ({ providerType, expectedDiagnostics }) => {
      const declaration = declaredNavigation.replace(
        "(): Navigation;",
        `(): Navigation | ${providerType};`,
      );
      const source = buildDeclaredListenerFixture(declaration).replace(
        "= useNavigation();",
        "= useNavigation()!;",
      );
      const result = runRule(rule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    },
  );

  it.each([2, 32, 128])("keeps %s sibling receiver bindings independent", (componentCount) => {
    const source = buildDeclaredListenerFixture(declaredNavigation);
    const sibling = source.slice(source.indexOf("export const Screen"));
    const siblings = Array.from({ length: componentCount - 1 }, (_, componentIndex) =>
      sibling.replace("Screen", `SiblingScreen${componentIndex}`),
    );
    const result = runRule(rule, `${source}\n${siblings.join("\n")}`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the callable contract independently of the provider name", () => {
    const source = buildDeclaredListenerFixture(declaredNavigation).replaceAll(
      "useNavigation",
      "createReceiver",
    );
    const result = runRule(rule, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["finally release", "return () => { try {} finally { unsubscribe(); } };"],
    [
      "two released listeners",
      'const secondUnsubscribe = navigation.addListener("transitionEnd", () => {}); return () => { unsubscribe(); secondUnsubscribe(); };',
    ],
  ])("preserves the existing navigation receiver's %s", (_, cleanup) => {
    const source = buildDeclaredListenerFixture(declaredNavigation, "", cleanup).replaceAll(
      "coveredNavigation",
      "navigation",
    );
    const result = runRule(rule, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "subscription object",
      "addListener: (event: string, callback: () => void) => { remove(): void }",
    ],
    ["void result", "addListener: (event: string, callback: () => void) => void"],
    ["promise result", "addListener: (event: string, callback: () => void) => Promise<() => void>"],
    [
      "optional result",
      "addListener: (event: string, callback: () => void) => (() => void) | undefined",
    ],
    ["optional listener", "addListener?: (event: string, callback: () => void) => () => void"],
    ["generic listener", "addListener: <Value>(event: string, callback: () => void) => () => void"],
    ["generic disposer", "addListener: (event: string, callback: () => void) => <Value>() => void"],
    [
      "disposer argument",
      "addListener: (event: string, callback: () => void) => (value: string) => void",
    ],
    [
      "overloaded listener",
      "addListener(event: string, callback: () => void): () => void; addListener(event: string, callback: () => void): { remove(): void }",
    ],
    ["computed listener", '["addListener"]: (event: string, callback: () => void) => () => void'],
    ["getter listener", "get addListener(): () => void"],
    [
      "mixed provider methods",
      'addListener(event: string, callback: () => void): () => void; "addListener"(event: string, callback: () => void): { remove(): void }',
    ],
  ])("keeps unsupported %s contracts reported", (_, member) => {
    const result = runRule(
      rule,
      buildDeclaredListenerFixture(
        `interface Navigation { ${member}; } declare function useNavigation(): Navigation;`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "runtime body",
      "const useNavigation = (): Navigation => ({ addListener: () => ({ remove() {} }) });",
    ],
    ["generic factory", "declare function useNavigation<Value>(): Navigation;"],
    [
      "overloaded factory",
      "declare function useNavigation(): Navigation; declare function useNavigation(value: string): Navigation;",
    ],
    [
      "namespace merge",
      "declare function useNavigation(): Navigation; namespace useNavigation { export const changed = true; }",
    ],
  ])("does not trust a %s provider", (_, provider) => {
    const result = runRule(
      rule,
      buildDeclaredListenerFixture(
        `interface Navigation { addListener: (event: string, callback: () => void) => () => void; } ${provider}`,
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["receiver reassignment", "coveredNavigation = anotherNavigation;"],
    ["direct method replacement", "coveredNavigation.addListener = () => ({ remove() {} });"],
    [
      "alias mutation",
      "const alias = coveredNavigation; alias.addListener = () => ({ remove() {} });",
    ],
    ["container escape", "const container = [coveredNavigation]; mutate(container);"],
    ["argument escape", "mutate(coveredNavigation);"],
    ["array argument escape", "mutate([coveredNavigation]);"],
    ["returned identity", "const alias = coveredNavigation.valueOf(); mutate(alias);"],
    ["identity helper", "const identity = (value) => value; mutate(identity(coveredNavigation));"],
    ["factory replacement", "useNavigation = anotherFactory;"],
    ["global factory replacement", 'globalThis["useNavigation"] = anotherFactory;'],
    ["catch binding replacement", "try {} catch ({ coveredNavigation = anotherNavigation }) {}"],
  ])("does not trust a %s", (_, beforeEffect) => {
    const result = runRule(rule, buildDeclaredListenerFixture(declaredNavigation, beforeEffect));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["missing cleanup", ""],
    ["wrong handle", "return () => { anotherUnsubscribe(); };"],
    ["conditional cleanup", "return () => { if (enabled) unsubscribe(); };"],
    ["conditional return", "if (enabled) return () => { unsubscribe(); };"],
    ["early return", "return () => { if (enabled) return; unsubscribe(); };"],
    ["throw before cleanup", "return () => { throw new Error(); unsubscribe(); };"],
    ["unknown call before cleanup", "return () => { mayThrow(); unsubscribe(); };"],
    ["unknown call before returning cleanup", "mayThrow(); return () => { unsubscribe(); };"],
    ["cleanup parameter initializer", "return (value = mayThrow()) => { unsubscribe(); };"],
    [
      "cleanup reacquisition",
      'return () => { unsubscribe(); coveredNavigation.addListener("transitionEnd", () => {}); };',
    ],
    [
      "cleanup acquisition before release",
      'return () => { coveredNavigation.addListener("transitionEnd", () => {}); unsubscribe(); };',
    ],
    [
      "retained callback acquisition",
      'retain(() => { coveredNavigation.addListener("transitionEnd", () => {}); }); return () => { unsubscribe(); };',
    ],
    [
      "second acquisition",
      'coveredNavigation.addListener("transitionEnd", () => {}); return () => { unsubscribe(); };',
    ],
  ])("still reports %s", (_, cleanup) => {
    const result = runRule(rule, buildDeclaredListenerFixture(declaredNavigation, "", cleanup));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
