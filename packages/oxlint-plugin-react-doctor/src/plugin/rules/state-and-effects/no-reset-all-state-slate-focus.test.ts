import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";
import { isMatchedSlateCurrentFocusRead } from "./utils/is-matched-slate-current-focus-read.js";

interface FocusReadCase {
  name: string;
  code?: string;
  facade?: string;
  files?: Record<string, string>;
  matches: boolean;
  declaration?: string | null;
  installedManifest?: string;
  preservesObservedOldWarning?: boolean;
}

let fixtureDirectory = "";
const resetFixtureCaches = (): void => {
  resetFilesystemCaches();
};
beforeEach(() => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-focus-api-"));
  resetFixtureCaches();
});
afterEach(() => {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  resetFixtureCaches();
});

const BASE_CODE = `import { useEffect, useState } from "react";
import { FocusApi } from "./focus-api";
export const FocusPanel = ({ entity }: { entity: object }) => {
  const [focused, setFocused] = useState(FocusApi.isFocused(entity));
  useEffect(() => { setFocused(FocusApi.isFocused(entity)); }, [entity]);
  return <output>{String(focused)}</output>;
};
`;
const BASE_FACADE = `import { DOMEditor } from "slate-dom";
export const FocusApi = DOMEditor;
`;
const TYPED_CURRENT_FOCUS_FACADE = `import { DOMEditor as CurrentEditor } from "slate-dom";
export interface FocusApi extends CurrentEditor {
  readonly label?: string;
}
export const FocusApi: FocusApi = CurrentEditor;
`;
const DIRECT_SDK_CODE = BASE_CODE.replace(
  'import { FocusApi } from "./focus-api";',
  'import { DOMEditor as FocusApi } from "slate-dom";',
);
const DUPLICATE_ALIAS_WRITE = "MutableFocusApi.isFocused = () => false;";
const UNIQUE_REPLACEMENT_PARTS = 2;
const SETTER_PATTERN_INDEX = 1;
const EXPECTED_SINGLE_REPORT = 1;
const BASE_FIXTURE_INDEX = 0;

const replaceFixtureText = (source: string, previous: string, replacement: string): string => {
  expect(source.split(previous)).toHaveLength(UNIQUE_REPLACEMENT_PARTS);
  return source.replace(previous, replacement);
};
const insertBeforeState = (statement: string): string =>
  replaceFixtureText(BASE_CODE, "  const [focused", `  ${statement}\n  const [focused`);

const cases: FocusReadCase[] = [
  {
    name: "type-only hook and provider exports",
    matches: true,
    code: BASE_CODE + "\nexport type {useState,FocusApi};",
  },
  {
    name: "erased React hook beside the genuine value",
    matches: true,
    code: "interface useState {}\n" + BASE_CODE,
  },
  {
    name: "transparent current focus result",
    matches: true,
    code: BASE_CODE.replaceAll(
      "FocusApi.isFocused(entity)",
      "(FocusApi.isFocused(entity) as boolean)",
    ),
  },
  {
    name: "inert capability property names",
    matches: true,
    code: "const labels={Function:'description',constructor:'description'};\n" + BASE_CODE,
  },

  {
    name: "immutable-relative-facade",
    matches: true,
  },
  {
    name: "direct-named-sdk-import",
    matches: true,
    code: replaceFixtureText(
      BASE_CODE,
      'import { FocusApi } from "./focus-api";',
      'import { DOMEditor as FocusApi } from "slate-dom";',
    ),
  },
  {
    name: "renamed-facade-import-and-sdk-import",
    matches: true,
    code: BASE_CODE.replace(
      "import { FocusApi }",
      "import { FocusApi as CurrentFocusApi }",
    ).replaceAll("FocusApi.isFocused", "CurrentFocusApi.isFocused"),
    facade:
      'import { DOMEditor as EditorProvider } from "slate-dom";\nexport const FocusApi = EditorProvider;\n',
  },
  {
    name: "renamed-genuine-react-hooks",
    matches: true,
    code: BASE_CODE.replace("useEffect, useState", "useEffect as observe, useState as keep")
      .replace("= useState(", "= keep(")
      .replace("  useEffect(", "  observe("),
  },
  {
    name: "same-name-erased-facade-interface",
    matches: true,
    facade:
      'import { DOMEditor } from "slate-dom";\nexport interface FocusApi { label?: string }\nexport const FocusApi: FocusApi = DOMEditor;\n',
  },
  {
    name: "ordinary-key-field-mutation-is-not-key-rebinding",
    matches: true,
    code: insertBeforeState('Object.assign(entity, { label: "ready" });'),
  },
  {
    name: "unrelated-callback-and-extra-ordinary-read",
    matches: true,
    code: insertBeforeState(
      "const refreshLabel = () => String(FocusApi.isFocused(entity));\n  void refreshLabel;",
    ),
  },
  {
    name: "consumer-provider-member-replacement",
    matches: false,
    code: insertBeforeState("FocusApi.isFocused = () => false;"),
    preservesObservedOldWarning: true,
  },
  {
    name: "provider-argument-escape",
    matches: false,
    code: insertBeforeState("Object.assign(FocusApi, { isFocused: () => false });"),
  },
  {
    name: "provider-nested-destructuring-assignment",
    matches: false,
    code: insertBeforeState("({ provider: FocusApi.isFocused } = { provider: () => false });"),
  },
  {
    name: "runtime-enum-provider-write",
    matches: false,
    code: insertBeforeState("enum Boundary { Changed = (FocusApi.isFocused = () => false, 0) }"),
  },
  {
    name: "computed-provider-read",
    matches: false,
    code: BASE_CODE.replaceAll("FocusApi.isFocused", 'FocusApi["isFocused"]'),
  },
  {
    name: "optional-provider-read",
    matches: false,
    code: BASE_CODE.replaceAll("FocusApi.isFocused(entity)", "FocusApi?.isFocused(entity)"),
  },
  {
    name: "unselected-method",
    matches: false,
    code: BASE_CODE.replaceAll("isFocused", "isReadOnly"),
  },
  {
    name: "local-provider-alias",
    matches: false,
    code: insertBeforeState("const reader = FocusApi;").replaceAll(
      "FocusApi.isFocused",
      "reader.isFocused",
    ),
  },
  {
    name: "sdk-default-provider",
    matches: false,
    facade: 'import DOMEditor from "slate-dom";\nexport const FocusApi = DOMEditor;\n',
  },
  {
    name: "sdk-type-only-provider",
    matches: false,
    facade: 'import type { DOMEditor } from "slate-dom";\nexport const FocusApi = DOMEditor;\n',
  },
  {
    name: "facade-extra-local-alias",
    matches: false,
    facade:
      'import { DOMEditor } from "slate-dom";\nconst local = DOMEditor;\nexport const FocusApi = local;\n',
  },
  {
    name: "facade-import-member-write",
    matches: false,
    facade:
      'import { DOMEditor } from "slate-dom";\nexport const FocusApi = DOMEditor;\nDOMEditor.isFocused = () => false;\n',
  },
  {
    name: "facade-import-escape",
    matches: false,
    facade:
      'import { DOMEditor } from "slate-dom";\nexport const FocusApi = DOMEditor;\nObject.assign(DOMEditor, { isFocused: () => false });\n',
  },
  {
    name: "opaque-local-provider",
    matches: false,
    facade: "export const FocusApi = { isFocused: (value: object) => false };\n",
  },
  {
    name: "intervening-effect-callback",
    matches: false,
    code: replaceFixtureText(
      BASE_CODE,
      "() => { setFocused",
      "() => { queueMicrotask(() => {}); setFocused",
    ),
  },
  {
    name: "effect-parameter-default",
    matches: false,
    code: BASE_CODE.replace("useEffect(() => {", "useEffect((marker = claim()) => {").replace(
      "export const FocusPanel",
      'const claim = () => { throw new Error("busy"); };\nexport const FocusPanel',
    ),
  },
  {
    name: "asynchronous-effect",
    matches: false,
    code: replaceFixtureText(BASE_CODE, "useEffect(() => {", "useEffect(async () => {"),
  },
  {
    name: "lazy-initial-state",
    matches: false,
    code: replaceFixtureText(
      BASE_CODE,
      "useState(FocusApi.isFocused(entity))",
      "useState(() => FocusApi.isFocused(entity))",
    ),
  },
  {
    name: "different-read-key",
    matches: false,
    code: BASE_CODE.replace(
      "entity }: { entity: object }",
      "entity, alternate }: { entity: object; alternate: object }",
    ).replace(
      "setFocused(FocusApi.isFocused(entity))",
      "setFocused(FocusApi.isFocused(alternate))",
    ),
  },
  {
    name: "deferred-key-rebinding",
    matches: false,
    code: insertBeforeState(
      "const replaceKey = () => { entity = {}; };\n  queueMicrotask(replaceKey);",
    ),
    preservesObservedOldWarning: true,
  },
  {
    name: "selected-key-effectful-default",
    matches: false,
    code: BASE_CODE.replace(
      "({ entity }: { entity: object })",
      "({ entity = claim() }: { entity?: object })",
    ).replace("export const FocusPanel", "const claim = () => ({});\nexport const FocusPanel"),
  },
  {
    name: "key-nested-binding-write",
    matches: false,
    code: insertBeforeState("({ entity } = { entity: {} });"),
  },
  {
    name: "function-constructor-capability",
    matches: false,
    code: insertBeforeState('Function("return 1")();'),
  },
  {
    name: "missing-sdk-declaration",
    matches: false,
    declaration: null,
  },
  {
    name: "unsupported-declared-sdk",
    matches: false,
    declaration: "^0.127.0",
    preservesObservedOldWarning: true,
  },
  {
    name: "exact-declaration-is-not-selected-fallback",
    matches: false,
    declaration: "0.126.0",
  },
  {
    name: "resolved-exact-sdk-metadata",
    matches: true,
    installedManifest: '{"name":"slate-dom","version":"0.126.0"}',
  },
  {
    name: "resolved-prerelease-metadata",
    matches: false,
    installedManifest: '{"name":"slate-dom","version":"0.126.0-beta.1"}',
  },
  {
    name: "resolved-invalid-json-blocks-caret-fallback",
    matches: false,
    installedManifest: '{"name":',
  },
  {
    name: "resolved-primitive-blocks-caret-fallback",
    matches: false,
    installedManifest: "false",
  },
  {
    name: "direct-sdk-duplicate-alias-in-one-declaration",
    matches: false,
    code: DIRECT_SDK_CODE.replace(
      "DOMEditor as FocusApi",
      "DOMEditor as FocusApi, DOMEditor as MutableFocusApi",
    ).replace("  const [focused", `  ${DUPLICATE_ALIAS_WRITE}\n  const [focused`),
  },
  {
    name: "direct-sdk-duplicate-separate-declaration",
    matches: false,
    code: DIRECT_SDK_CODE.replace(
      "export const FocusPanel",
      'import { DOMEditor as MutableFocusApi } from "slate-dom";\nexport const FocusPanel',
    ).replace("  const [focused", `  ${DUPLICATE_ALIAS_WRITE}\n  const [focused`),
  },
  {
    name: "facade-provider-duplicate-sdk-alias",
    matches: false,
    facade: BASE_FACADE.replace(
      "{ DOMEditor }",
      "{ DOMEditor, DOMEditor as MutableFocusApi }",
    ).replace("export const FocusApi", `${DUPLICATE_ALIAS_WRITE}\nexport const FocusApi`),
  },
  {
    name: "consumer-same-facade-different-canonical-path-spelling",
    matches: false,
    code: insertBeforeState(DUPLICATE_ALIAS_WRITE).replace(
      "export const FocusPanel",
      'import { FocusApi as MutableFocusApi } from "./focus-api.ts";\nexport const FocusPanel',
    ),
  },
  {
    name: "consumer-facade-and-direct-sdk-alias",
    matches: false,
    code: insertBeforeState(DUPLICATE_ALIAS_WRITE).replace(
      "export const FocusPanel",
      'import { DOMEditor as MutableFocusApi } from "slate-dom";\nexport const FocusPanel',
    ),
  },
  {
    name: "consumer-sdk-namespace-alias",
    matches: false,
    code: DIRECT_SDK_CODE.replace(
      "export const FocusPanel",
      'import * as SdkNamespace from "slate-dom";\nexport const FocusPanel',
    ).replace(
      "  const [focused",
      "  SdkNamespace.DOMEditor.isFocused = () => false;\n  const [focused",
    ),
  },
  {
    name: "selected-direct-sdk-and-relative-facade-alias",
    matches: false,
    code: DIRECT_SDK_CODE.replace(
      "export const FocusPanel",
      'import { FocusApi as MutableFocusApi } from "./focus-api";\nexport const FocusPanel',
    ).replace("  const [focused", `  ${DUPLICATE_ALIAS_WRITE}\n  const [focused`),
  },
  {
    name: "two-distinct-relative-direct-const-facades",
    matches: false,
    code: insertBeforeState(DUPLICATE_ALIAS_WRITE).replace(
      "export const FocusPanel",
      'import { FocusApi as MutableFocusApi } from "./other-focus-api";\nexport const FocusPanel',
    ),
    files: { "other-focus-api.ts": BASE_FACADE },
  },
  {
    name: "second-facade-opaque-replacement-escape",
    matches: false,
    code: BASE_CODE.replace(
      "export const FocusPanel",
      'import { FocusApi as MutableFocusApi } from "./other-focus-api";\nexport const FocusPanel',
    )
      .replace(
        "({ entity }: { entity: object })",
        "({ entity, replacement }: { entity: object; replacement: object })",
      )
      .replace(
        "  const [focused",
        "  Object.assign(MutableFocusApi, replacement);\n  const [focused",
      ),
    files: { "other-focus-api.ts": BASE_FACADE },
  },
  {
    name: "readonly-secondary-provider-origin-is-also-declined",
    matches: false,
    code: DIRECT_SDK_CODE.replace(
      "export const FocusPanel",
      'import { FocusApi as OtherFocusApi } from "./focus-api";\nexport const FocusPanel',
    ),
  },
  {
    name: "same-facade-namespace-import",
    matches: false,
    code: BASE_CODE.replace(
      "export const FocusPanel",
      'import * as OtherFocusApi from "./focus-api.ts";\nexport const FocusPanel',
    ),
  },
  {
    name: "same-facade-default-import",
    matches: false,
    code: BASE_CODE.replace(
      "export const FocusPanel",
      'import OtherFocusApi from "./focus-api.ts";\nexport const FocusPanel',
    ),
  },
  {
    name: "type-only-sdk-alias-is-not-a-runtime-origin",
    matches: true,
    code: DIRECT_SDK_CODE.replace(
      "export const FocusPanel",
      'import type { DOMEditor as OtherFocusApi } from "slate-dom";\nexport const FocusPanel',
    ),
  },
  {
    name: "inline-type-only-facade-alias-is-not-a-runtime-origin",
    matches: true,
    code: BASE_CODE.replace("{ FocusApi }", "{ FocusApi, type FocusApi as OtherFocusApi }"),
  },
  {
    name: "unrelated-sdk-export-stays-supported",
    matches: true,
    code: BASE_CODE.replace(
      "export const FocusPanel",
      'import { EDITOR_TO_ON_CHANGE } from "slate-dom";\nexport const FocusPanel',
    ),
  },

  {
    name: "sdk-default-as-import-matches-default-policy",
    matches: false,
    code: DIRECT_SDK_CODE.replace(
      "export const FocusPanel",
      'import { default as OtherFocusApi } from "slate-dom";\nexport const FocusPanel',
    ),
  },
  {
    name: "canonical-facade-default-as-import-matches-default-policy",
    matches: false,
    code: BASE_CODE.replace(
      "export const FocusPanel",
      'import { default as OtherFocusApi } from "./focus-api.ts";\nexport const FocusPanel',
    ),
  },

  {
    name: "facade-erased-interface-heritage-retains-one-runtime-origin",
    matches: true,
    facade: TYPED_CURRENT_FOCUS_FACADE,
  },
  {
    name: "facade-runtime-extra-reference-beside-erased-heritage-declines",
    matches: false,
    facade: TYPED_CURRENT_FOCUS_FACADE.replace(
      "export const FocusApi",
      "void CurrentEditor;\nexport const FocusApi",
    ),
  },
  {
    name: "facade-runtime-provider-write-beside-erased-heritage-declines",
    matches: false,
    facade: TYPED_CURRENT_FOCUS_FACADE.replace(
      "export const FocusApi",
      "CurrentEditor.isFocused = () => false;\nexport const FocusApi",
    ),
  },
];

const materializeCase = (fixture: FocusReadCase): string => {
  const dependencies: Record<string, string> = { react: "18.2.0" };
  if (fixture.declaration !== null) dependencies["slate-dom"] = fixture.declaration ?? "^0.126.0";
  fs.writeFileSync(
    path.join(fixtureDirectory, "package.json"),
    JSON.stringify({ private: true, dependencies }),
  );
  fs.writeFileSync(path.join(fixtureDirectory, "focus-api.ts"), fixture.facade ?? BASE_FACADE);
  for (const [relativePath, contents] of Object.entries(fixture.files ?? {})) {
    fs.writeFileSync(path.join(fixtureDirectory, relativePath), contents);
  }
  const filename = path.join(fixtureDirectory, "FocusPanel.tsx");
  fs.writeFileSync(filename, fixture.code ?? BASE_CODE);
  if (fixture.installedManifest !== undefined) {
    const dependencyDirectory = path.join(fixtureDirectory, "node_modules", "slate-dom");
    fs.mkdirSync(dependencyDirectory, { recursive: true });
    fs.writeFileSync(path.join(dependencyDirectory, "package.json"), fixture.installedManifest);
  }
  resetFixtureCaches();
  return filename;
};

const focusCertificateProbe: Rule = {
  id: "slate-focus-read-certificate-probe",
  severity: "warn",
  create: (context) => {
    let stateDeclaration: EsTreeNodeOfType<"VariableDeclarator"> | null = null;
    return {
      VariableDeclarator: (node) => {
        if (!isNodeOfType(node.id, "ArrayPattern")) return;
        const setter = node.id.elements[SETTER_PATTERN_INDEX];
        if (isNodeOfType(setter, "Identifier") && setter.name === "setFocused")
          stateDeclaration = node;
      },
      CallExpression: (node) => {
        if (
          !stateDeclaration ||
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== "setFocused"
        )
          return;
        context.report({
          node,
          message: isMatchedSlateCurrentFocusRead(context, stateDeclaration, node)
            ? "matched"
            : "declined",
        });
      },
    };
  },
};

describe.each([
  { name: "direct", rule: noResetAllStateOnPropChange, probe: focusCertificateProbe },
  {
    name: "semantic wrapper",
    rule: wrapWithSemanticContext(noResetAllStateOnPropChange),
    probe: wrapWithSemanticContext(focusCertificateProbe),
  },
])("ordinary Slate current focus ($name)", ({ rule, probe }) => {
  it.each(cases)("$name", (fixture) => {
    const code = fixture.code ?? BASE_CODE;
    const filename = materializeCase(fixture);
    const options = { filename, forceJsx: true, includeLocations: true };
    const certificate = runRule(probe, code, options);
    expect(certificate.parseErrors).toEqual([]);
    expect(certificate.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      fixture.matches ? "matched" : "declined",
    ]);
    const result = runRule(rule, code, options);
    expect(result.parseErrors).toEqual([]);
    if (fixture.matches) expect(result.diagnostics).toEqual([]);
    if (fixture.preservesObservedOldWarning)
      expect(result.diagnostics).toHaveLength(EXPECTED_SINGLE_REPORT);
  });

  it("re-evaluates unchanged consumer after same-size restored-mtime facade changes at the production filesystem epoch boundary", () => {
    const fixture = cases[BASE_FIXTURE_INDEX];
    const filename = materializeCase(fixture);
    const provider = path.join(fixtureDirectory, "focus-api.ts");
    const before = fs.statSync(provider);
    const changed = BASE_FACADE.replace("= DOMEditor", "= DOMEditox");
    expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(BASE_FACADE));
    expect(
      runRule(probe, fixture.code ?? BASE_CODE, { filename, forceJsx: true }).diagnostics.map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual(["matched"]);
    fs.writeFileSync(provider, changed);
    fs.utimesSync(provider, before.atime, before.mtime);
    resetFixtureCaches();
    expect(fs.readFileSync(filename, "utf8")).toBe(fixture.code ?? BASE_CODE);
    const current = runRule(probe, fixture.code ?? BASE_CODE, { filename, forceJsx: true });
    expect(current.parseErrors).toEqual([]);
    expect(current.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["declined"]);
    resetFixtureCaches();
    expect(runRule(probe, fixture.code ?? BASE_CODE, { filename, forceJsx: true })).toEqual(
      current,
    );
  });

  it("records metadata and facade dependencies on cold and warm collection", () => {
    const fixture = cases[BASE_FIXTURE_INDEX];
    const filename = materializeCase(fixture);
    const request = {
      absoluteFilePath: filename,
      sourceText: fixture.code ?? BASE_CODE,
      ruleIds: ["no-reset-all-state-on-prop-change"],
    };
    const cold = collectCrossFileDependencyProbes(request);
    const warm = collectCrossFileDependencyProbes(request);
    expect(cold).not.toBeNull();
    expect(warm).toEqual(cold);
    expect(cold?.contentPaths).toContain(path.join(fixtureDirectory, "focus-api.ts"));
    expect(cold?.contentPaths).toContain(path.join(fixtureDirectory, "package.json"));
    expect(cold?.existencePaths).toContain(
      path.join(fixtureDirectory, "node_modules", "slate-dom", "package.json"),
    );
  });

  it("records negative secondary-origin probes and declines after a second facade appears", () => {
    const code = BASE_CODE.replace(
      "export const FocusPanel",
      'import { FocusApi as OtherFocusApi } from "./other-focus-api";\nexport const FocusPanel',
    );
    const fixture: FocusReadCase = { name: "secondary-origin-appearance", matches: true, code };
    const filename = materializeCase(fixture);
    const otherProviderPath = path.join(fixtureDirectory, "other-focus-api.ts");
    const request = {
      absoluteFilePath: filename,
      sourceText: code,
      ruleIds: ["no-reset-all-state-on-prop-change"],
    };
    const before = runRule(probe, code, { filename, forceJsx: true });
    expect(before.parseErrors).toEqual([]);
    expect(before.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["matched"]);
    const missing = collectCrossFileDependencyProbes(request);
    expect(missing?.existencePaths).toContain(otherProviderPath);
    fs.writeFileSync(otherProviderPath, BASE_FACADE);
    resetFixtureCaches();
    const current = runRule(probe, code, { filename, forceJsx: true });
    expect(current.parseErrors).toEqual([]);
    expect(current.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["declined"]);
    const appeared = collectCrossFileDependencyProbes(request);
    expect(appeared?.contentPaths).toContain(otherProviderPath);
    expect(collectCrossFileDependencyProbes(request)).toEqual(appeared);
  });

  it("re-evaluates same-size restored-mtime SDK declaration changes", () => {
    const fixture = cases[BASE_FIXTURE_INDEX];
    const filename = materializeCase(fixture);
    const manifest = path.join(fixtureDirectory, "package.json");
    const before = fs.statSync(manifest);
    const original = fs.readFileSync(manifest, "utf8");
    expect(
      runRule(probe, fixture.code ?? BASE_CODE, { filename, forceJsx: true }).diagnostics.map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual(["matched"]);
    const unsupported = original.replace("^0.126.0", "^0.127.0");
    expect(Buffer.byteLength(unsupported)).toBe(Buffer.byteLength(original));
    fs.writeFileSync(manifest, unsupported);
    fs.utimesSync(manifest, before.atime, before.mtime);
    resetFixtureCaches();
    const current = runRule(probe, fixture.code ?? BASE_CODE, { filename, forceJsx: true });
    expect(current.parseErrors).toEqual([]);
    expect(current.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["declined"]);
    expect(fs.readFileSync(filename, "utf8")).toBe(fixture.code ?? BASE_CODE);
  });
});
