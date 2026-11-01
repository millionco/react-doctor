import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { getRuntimeStaticDependencySource } from "../get-runtime-static-dependency-source.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { walkAst } from "../walk-ast.js";
import { createPrivatePrimitiveArrayReadCertificate } from "./create-private-primitive-array-read-certificate.js";

const literalSource = `const values=['quay',null,true,17]; const selected=values[0];`;
const ownerSource = `import {useRef} from 'react';
const values=['quay','tile'];
export function View(props) {
 const index=useRef(0);
 const selected=values[index.current];
 index.current=(index.current+1)%values.length;
 return <div>{selected}</div>;
}`;

interface ArrayFixture {
  module: SourceProjectModule;
  project: SourceProjectIndex;
  member: EsTreeNode;
}

const fixture = (
  source = literalSource,
  consumers: Readonly<Record<string, string>> = {},
): ArrayFixture => {
  const modules = new Map<string, SourceProjectModule>();
  for (const [name, text] of Object.entries({ "owner.tsx": source, ...consumers })) {
    const parsed = parseFixture(text);
    expect(parsed.errors).toEqual([]);
    if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
    attachParentReferences(parsed.program);
    const filePath = path.resolve("/array-fixture", name);
    modules.set(filePath, {
      filePath,
      programNode: parsed.program,
      scopes: analyzeScopes(parsed.program),
    });
  }
  const module = modules.get("/array-fixture/owner.tsx");
  if (!module) throw new Error("Missing owner");
  const consumerModulesByFilePath = new Map<string, Set<SourceProjectModule>>();
  const resolvedSourcePathByNode = new WeakMap<EsTreeNode, string>();
  for (const current of modules.values())
    walkAst(current.programNode, (node) => {
      const source = getRuntimeStaticDependencySource(node);
      if (source !== "./owner") return;
      resolvedSourcePathByNode.set(node, module.filePath);
      const consumerSet = consumerModulesByFilePath.get(module.filePath) ?? new Set();
      consumerSet.add(current);
      consumerModulesByFilePath.set(module.filePath, consumerSet);
    });
  let member: EsTreeNode | null = null;
  walkAst(module.programNode, (node) => {
    if (
      !member &&
      isNodeOfType(node, "MemberExpression") &&
      node.computed &&
      isNodeOfType(node.object, "Identifier") &&
      node.object.name === "values"
    )
      member = node;
  });
  if (!member) throw new Error("Missing selected array read");
  return {
    module,
    member,
    project: {
      modulesByFilePath: modules,
      htmlFilePaths: [],
      consumerModulesByFilePath,
      resolvedSourcePathByNode,
      unresolvedRuntimeSources: new Set(),
      hasOpaqueMdxConsumerSurface: false,
    },
  };
};
const certifies = (
  source = literalSource,
  consumers: Readonly<Record<string, string>> = {},
  provideProject = true,
): boolean => {
  const current = fixture(source, consumers);
  return createPrivatePrimitiveArrayReadCertificate(
    current.module.scopes,
    provideProject ? current.project : undefined,
  )(current.member);
};

describe("createPrivatePrimitiveArrayReadCertificate", () => {
  it("reuses completed flag inventories for repeated converging readonly aliases", () => {
    const current = fixture(
      "const origin=['a','b'];const values=origin;const second=origin;const first=values[0];const next=second[1];",
    );
    const certify = createPrivatePrimitiveArrayReadCertificate(
      current.module.scopes,
      current.project,
    );
    expect(certify(current.member)).toBe(true);
    let flagReads = 0;
    for (const symbol of current.module.scopes.rootScope.symbols) {
      if (!["origin", "values", "second"].includes(symbol.name)) continue;
      for (const reference of symbol.references) {
        const flag = reference.flag;
        Object.defineProperty(reference, "flag", {
          get: () => {
            flagReads += 1;
            return flag;
          },
        });
      }
    }
    const reads: EsTreeNode[] = [];
    walkAst(current.module.programNode, (node) => {
      if (isNodeOfType(node, "MemberExpression") && node.computed) reads.push(node);
    });
    for (const read of [...reads, ...reads]) expect(certify(read)).toBe(true);
    expect(flagReads).toBe(0);
  });
  it("certifies explicit finite primitive elements including checked null", () =>
    expect(certifies()).toBe(true));
  it("supports readonly literal and array aliases", () =>
    expect(
      certifies(
        `const origin=['a','b'];const values=origin;const position=1;const key=position;const selected=values[key];`,
      ),
    ).toBe(true));
  it("does not require a project for literal indices", () =>
    expect(certifies(literalSource, {}, false)).toBe(true));
  it("accepts a named exported component with private bounded ref state and no indexed importer", () =>
    expect(certifies(ownerSource)).toBe(true));
  it("accepts inrange direct literal resets", () =>
    expect(
      certifies(
        ownerSource.replace("index.current=(index.current+1)%values.length", "index.current=1"),
      ),
    ).toBe(true));
  it("accepts readonly genuine hook alias and preceding literal/ref acquisitions", () =>
    expect(
      certifies(
        ownerSource
          .replace("const values=", "const useIndex=useRef; const values=")
          .replace(
            "const index=useRef(0)",
            'const label="x"; const other=useRef(null); const index=useIndex(0)',
          ),
      ),
    ).toBe(true));
  it("accepts default function/page owners", () =>
    expect(
      certifies(
        ownerSource.replace("export function View(props)", "export default function page(props)"),
      ),
    ).toBe(true));
  it("accepts anonymous default owners", () =>
    expect(
      certifies(
        ownerSource.replace("export function View(props)", "export default function(props)"),
      ),
    ).toBe(true));
  it("accepts readonly const component exports", () =>
    expect(
      certifies(
        ownerSource
          .replace("export function View(props) {", "export const View=props=>{")
          .replace("return <div>{selected}</div>;\n}", "return <div>{selected}</div>;\n};"),
      ),
    ).toBe(true));
  it("accepts owner aliases/export aliases and JSX-only named consumers", () =>
    expect(
      certifies(
        ownerSource +
          "\nconst Original=View;export {Original as Panel}; const Local=()=> <Original/>;",
        {
          "screen.tsx": `import {Panel as Imported} from './owner';const Alias=Imported;export const Screen=()=> <Alias/>;`,
        },
      ),
    ).toBe(true));
  it("accepts JSX-only default consumers", () =>
    expect(
      certifies(
        ownerSource.replace("export function View(props)", "export default function View(props)"),
        { "screen.tsx": `import Imported from './owner';export const Screen=()=> <Imported/>;` },
      ),
    ).toBe(true));
  it("accepts a private owner under scope-only JSX inventory", () =>
    expect(
      certifies(
        ownerSource.replace("export function View", "function View") +
          "\nconst Screen=()=> <View/>;",
        {},
        false,
      ),
    ).toBe(true));
  it.each([
    ["hole", "['quay',null,true,17]", "['quay',,true,17]"],
    ["spread", "['quay',null,true,17]", "['quay',...foreign]"],
    ["object", "['quay',null,true,17]", "['quay',{}]"],
    ["regex", "['quay',null,true,17]", "['quay',/x/]"],
    ["call", "['quay',null,true,17]", "['quay',foreign()]"],
    ["nonfinite", "['quay',null,true,17]", "['quay',1e400]"],
    ["mutable", "const values=", "let values="],
    ["empty", "['quay',null,true,17]", "[]"],
    ["out of range", "values[0]", "values[4]"],
    ["negative", "values[0]", "values[-1]"],
    ["fraction", "values[0]", "values[0.5]"],
    ["string key", "values[0]", "values['0']"],
    ["unknown key", "values[0]", "values[key]"],
    ["coercive key", "values[0]", "values[foreign]"],
    ["export", "const values=", "export const values="],
    ["element writer", "const selected=", "values[0]=foreign;const selected="],
    ["length writer", "const selected=", "values.length=1;const selected="],
    ["delete", "const selected=", "delete values[0];const selected="],
    ["update", "const selected=", "values[0]++;const selected="],
    ["method call", "const selected=", 'values.push("x");const selected='],
    [
      "descriptor",
      "const selected=",
      "Object.defineProperty(values,0,{get:foreign});const selected=",
    ],
    ["publication", "const selected=", "publish(values);const selected="],
    ["container alias", "const selected=", "const holder={values};const selected="],
    ["destructure", "const selected=", "const [first]=values;const selected="],
    ["alias publication", "const selected=", "const alias=values;publish(alias);const selected="],
  ])("refuses array %s", (_name, before, after) =>
    expect(certifies(literalSource.replace(before, after))).toBe(false),
  );
  it("refuses source-visible React.useRef replacement", () =>
    expect(
      certifies(
        ownerSource
          .replace("import {useRef} from 'react';", "import React from 'react';")
          .replace("useRef(0)", "React.useRef(0)") + "\nReact.useRef=foreign;",
      ),
    ).toBe(false));
  it("refuses source-visible React hook descriptor replacement", () =>
    expect(
      certifies(
        ownerSource +
          "\nimport React from 'react';Object.defineProperty(React,'useRef',{value:foreign});",
      ),
    ).toBe(false));
  it.each([
    ["missing project", ownerSource, false],
    ["out of range seed", ownerSource.replace("useRef(0)", "useRef(2)"), true],
    [
      "nonliteral seed",
      ownerSource.replace("const index=useRef(0)", "const seed=0;const index=useRef(seed)"),
      true,
    ],
    [
      "out of range reset",
      ownerSource.replace("index.current=(index.current+1)%values.length", "index.current=3"),
      true,
    ],
    [
      "nonliteral reset",
      ownerSource.replace(
        "index.current=(index.current+1)%values.length",
        "const reset=0;index.current=reset",
      ),
      true,
    ],
    [
      "increment update",
      ownerSource.replace("index.current=(index.current+1)%values.length", "index.current++"),
      true,
    ],
    [
      "compound update",
      ownerSource.replace("index.current=(index.current+1)%values.length", "index.current+=1"),
      true,
    ],
    [
      "arbitrary arithmetic",
      ownerSource.replace("(index.current+1)%values.length", "(index.current+2)%values.length"),
      true,
    ],
    [
      "other array length",
      ownerSource.replace("(index.current+1)%values.length", "(index.current+1)%foreign.length"),
      true,
    ],
    [
      "mutual ref cycle",
      ownerSource
        .replace("const index=useRef(0)", "const other=useRef(0);const index=useRef(0)")
        .replace("(index.current+1)%values.length", "(other.current+1)%values.length"),
      true,
    ],
    [
      "object escape",
      ownerSource.replace("const selected=", "publish(index);const selected="),
      true,
    ],
    [
      "object alias",
      ownerSource.replace("const selected=", "const alias=index;const selected="),
      true,
    ],
    [
      "descriptor replacement",
      ownerSource.replace(
        "const selected=",
        'Object.defineProperty(index,"current",{get:foreign});const selected=',
      ),
      true,
    ],
    [
      "current delete",
      ownerSource.replace("const selected=", "delete index.current;const selected="),
      true,
    ],
    [
      "other member",
      ownerSource.replace("const selected=", "publish(index.value);const selected="),
      true,
    ],
    [
      "unknown prior initializer",
      ownerSource.replace("const index=", "const setup=foreign();const index="),
      true,
    ],
    [
      "custom hook before ref",
      ownerSource.replace("const index=", "const setup=useCustom();const index="),
      true,
    ],
    ["parameter default", ownerSource.replace("View(props)", "View(props=foreign())"), true],
    ["destructured parameter", ownerSource.replace("View(props)", "View({value})"), true],
    ["async owner", ownerSource.replace("export function", "export async function"), true],
    [
      "nested owner",
      ownerSource.replace("export function View", "function outer(){function View") + "}",
      true,
    ],
    ["direct source owner call", ownerSource + "\nView({});", true],
    ["aliased source owner call", ownerSource + "\nconst Alias=View;Alias({});", true],
    ["source owner publication", ownerSource + "\npublish(View);", true],
    ["mutable source owner alias", ownerSource + "\nlet Alias=View;", true],
  ])("refuses numeric ref %s", (_name, source, provideProject) =>
    expect(certifies(source, {}, provideProject)).toBe(false),
  );
  it.each([
    `import {View} from './owner';View({});`,
    `import {View} from './owner';publish(View);`,
    `import {View} from './owner';export {View};`,
    `import {View} from './owner';export default View;`,
    `import {View} from './owner';export const Alias=View;`,
    `import {View} from './owner';const Alias=View;export {Alias};`,
    `export {View} from './owner';`,
    `export * from './owner';`,
    `import * as Owners from './owner';const Screen=()=> <Owners.View/>;`,
    `import {View} from './owner';const useCustom=()=>View({});`,
  ])("holds unsupported owner consumer %s", (consumer) =>
    expect(certifies(ownerSource, { "consumer.tsx": consumer })).toBe(false),
  );
});
