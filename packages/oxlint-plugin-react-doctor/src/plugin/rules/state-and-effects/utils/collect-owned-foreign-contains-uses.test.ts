import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { SourceProjectModule } from "../../../utils/build-source-project-index.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenStyledComponentExpression } from "../../../utils/is-proven-styled-component-expression.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resetFilesystemCaches } from "../../../utils/reset-filesystem-caches.js";
import type { Rule } from "../../../utils/rule.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { collectOwnedNativeRefUses } from "./collect-owned-native-ref-uses.js";
import { collectOwnedForeignContainsUses } from "./collect-owned-foreign-contains-uses.js";

interface ForeignContainsFixture {
  readonly name: string;
  readonly source: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly expected: number;
}

const roots: string[] = [];
const BASE_SOURCE = `import {useEffect,useRef} from 'react';
export const Surface=({children,onClose=()=>{},...rest})=>{
 const owned=useRef(null);
 useEffect(()=>{
  const onPointer=event=>{const target=event.target;if(owned.current&&!owned.current.contains(target))onClose();};
  window.addEventListener('click',onPointer);
  return()=>window.removeEventListener('click',onPointer);
 },[]);
 return <div ref={owned} {...rest}>{children}</div>;
};`;

const resolveOwnHost = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  module: SourceProjectModule,
): string | null => {
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return null;
  if (HTML_TAGS.has(opening.name.name)) return opening.name.name;
  const symbol = module.scopes.symbolFor(opening.name);
  const initial = symbol ? getDirectUnreassignedInitializer(symbol) : null;
  const value = initial ? stripParenExpression(initial) : null;
  if (
    !value ||
    !isNodeOfType(value, "TaggedTemplateExpression") ||
    !isProvenStyledComponentExpression(value, module.scopes)
  )
    return null;
  const factory = stripParenExpression(value.tag);
  if (!isNodeOfType(factory, "MemberExpression") || factory.optional || factory.computed)
    return null;
  const imported = resolveImportedApiReference(stripParenExpression(factory.object), module.scopes);
  const name = getStaticPropertyName(factory);
  return imported?.source === "styled-components" &&
    imported.importedName === "default" &&
    name &&
    HTML_TAGS.has(name)
    ? name
    : null;
};

const probeRule: Rule = {
  id: "owned-foreign-contains-probe",
  severity: "warn",
  create: (context) => ({
    Program: (program) => {
      if (!isNodeOfType(program, "Program") || !context.filename) return;
      const filename = context.filename;
      const index = buildSourceProjectIndex({
        rootDirectory: path.dirname(filename),
        currentFilePath: filename,
        currentProgramNode: program,
        currentScopes: context.scopes,
        includeApplicationDirectories: true,
      });
      const module = index?.modulesByFilePath.get(filename);
      if (!index || !module) return;
      const approved = collectOwnedForeignContainsUses({
        module,
        index,
        resolveHostName: resolveOwnHost,
      });
      const strict = collectOwnedNativeRefUses({ module, resolveHostName: resolveOwnHost });
      for (const node of approved)
        context.report({ node, message: "Exact foreign contains argument" });
      for (const symbol of strict.nativeRefs)
        context.report({ node: symbol.bindingIdentifier, message: "Strict native ref" });
    },
  }),
};

const fixtures: ReadonlyArray<ForeignContainsFixture> = [
  { name: "native foreign rest contains purpose", source: BASE_SOURCE, expected: 1 },
  {
    name: "own styled foreign rest contains purpose",
    source: BASE_SOURCE.replace(
      "import {useEffect,useRef}",
      "import styled from 'styled-components'; const Frame=styled.div``; import {useEffect,useRef}",
    )
      .replace("<div ref={owned}", "<Frame ref={owned}")
      .replace("</div>", "</Frame>"),
    expected: 1,
  },
  {
    name: "own wrapper rest forwards documented API",
    source:
      BASE_SOURCE +
      "\nexport const Wrapper=({children,label,...rest})=><Surface {...rest}>{children}</Surface>;",
    expected: 1,
  },
  {
    name: "relative caller and public barrel",
    source: BASE_SOURCE,
    files: {
      "barrel.ts": "export {Surface} from './entry';",
      "consumer.tsx":
        "import {Surface} from './barrel';export const Wrapper=({children,...rest})=><Surface {...rest}>{children}</Surface>;",
    },
    expected: 1,
  },
  {
    name: "ordinary Storybook args extraction",
    source:
      BASE_SOURCE +
      "\nconst Template=args=>{const {...rest}=args;return <Surface {...rest}/>};export const Default=Template.bind({});Default.args={role:'tooltip'};",
    expected: 1,
  },
  {
    name: "literal documented callback is consumed",
    source: BASE_SOURCE + "\nconst view=<Surface onClose={()=>notify()}/>;",
    expected: 1,
  },
  {
    name: "known polymorphic caller refuses",
    source: BASE_SOURCE + "\nconst view=<Surface as='section'/>;",
    expected: 0,
  },
  {
    name: "known caller ref refuses",
    source: BASE_SOURCE + "\nconst view=<Surface ref={observe}/>;",
    expected: 0,
  },
  {
    name: "known caller native event refuses",
    source: BASE_SOURCE + "\nconst view=<Surface onFocus={event=>publish(event.target)}/>;",
    expected: 0,
  },
  {
    name: "literal spread poison refuses",
    source: BASE_SOURCE + "\nconst view=<Surface {...{as:'section'}}/>;",
    expected: 0,
  },
  {
    name: "readonly literal spread alias poison refuses",
    source:
      BASE_SOURCE +
      "\nconst props={ref:observe};const alias=props;const view=<Surface {...alias}/>;",
    expected: 0,
  },
  {
    name: "readonly literal data aliases remain data",
    source:
      BASE_SOURCE +
      "\nconst props={role:'tooltip'};const alias=props;const view=<Surface {...alias}/>;",
    expected: 1,
  },
  {
    name: "known spread producer mutation refuses",
    source:
      BASE_SOURCE +
      "\nconst props={role:'tooltip'};props[opaque]=replacement;const view=<Surface {...props}/>;",
    expected: 0,
  },
  {
    name: "caller rest mutation refuses",
    source:
      BASE_SOURCE +
      "\nexport const Wrapper=({children,...rest})=>{rest.as='section';return <Surface {...rest}>{children}</Surface>};",
    expected: 0,
  },
  {
    name: "caller rest escape refuses",
    source:
      BASE_SOURCE +
      "\nexport const Wrapper=({children,...rest})=>{configure(rest);return <Surface {...rest}>{children}</Surface>};",
    expected: 0,
  },
  {
    name: "known Storybook args poison refuses",
    source:
      BASE_SOURCE +
      "\nconst Template=args=>{const {...rest}=args;return <Surface {...rest}/>};const Story=Template.bind({});Story.args={as:'section'};",
    expected: 0,
  },
  {
    name: "foreign ref raw escape refuses",
    source: BASE_SOURCE.replace(
      " const owned=useRef(null);",
      " const owned=useRef(null);publish(owned);",
    ),
    expected: 0,
  },
  {
    name: "foreign current replacement refuses",
    source: BASE_SOURCE.replace(
      " const owned=useRef(null);",
      " const owned=useRef(null);owned.current=foreign;",
    ),
    expected: 0,
  },
  {
    name: "contains method mutation refuses",
    source: BASE_SOURCE.replace(
      " const owned=useRef(null);",
      " const owned=useRef(null);owned.current.contains=replacement;",
    ),
    expected: 0,
  },
  {
    name: "target member mutation refuses",
    source: BASE_SOURCE.replace("if(owned.current", "target[opaque]=replacement;if(owned.current"),
    expected: 0,
  },
  {
    name: "target escape refuses",
    source: BASE_SOURCE.replace("if(owned.current", "publish(target);if(owned.current"),
    expected: 0,
  },
  {
    name: "target callable transport refuses",
    source: BASE_SOURCE.replace("if(owned.current", "target();if(owned.current"),
    expected: 0,
  },
  {
    name: "contains result is Boolean only",
    source: BASE_SOURCE.replace(
      "!owned.current.contains(target)",
      "!consume(owned.current.contains(target))",
    ),
    expected: 0,
  },
  {
    name: "contains result direct data escape refuses",
    source: BASE_SOURCE.replace(
      "if(owned.current&&!owned.current.contains(target))onClose();",
      "return owned.current.contains(target);",
    ),
    expected: 0,
  },
  {
    name: "listener callback escape refuses",
    source: BASE_SOURCE.replace(
      "  window.addEventListener('click',onPointer);",
      "  publish(onPointer);window.addEventListener('click',onPointer);",
    ),
    expected: 0,
  },
  {
    name: "listener alias remains exact registration",
    source: BASE_SOURCE.replace(
      "  window.addEventListener('click',onPointer);",
      "  const callback=onPointer;window.addEventListener('click',callback);",
    ),
    expected: 1,
  },
  {
    name: "listener foreign receiver refuses",
    source: BASE_SOURCE.replace("window.addEventListener", "emitter.addEventListener").replace(
      "window.removeEventListener",
      "emitter.removeEventListener",
    ),
    expected: 0,
  },
  {
    name: "nonfinal primary rest refuses",
    source: BASE_SOURCE.replace("ref={owned} {...rest}", 'ref={owned} {...rest} role="tooltip"'),
    expected: 0,
  },
  {
    name: "primary explicit host override refuses",
    source: BASE_SOURCE.replace("ref={owned} {...rest}", 'as="section" ref={owned} {...rest}'),
    expected: 0,
  },
  {
    name: "multiple publications refuse",
    source: BASE_SOURCE.replace(
      "return <div ref={owned} {...rest}>{children}</div>;",
      "return <><div ref={owned} {...rest}/><div ref={owned}/></>;",
    ),
    expected: 0,
  },
  {
    name: "earlier own return refuses",
    source: BASE_SOURCE.replace(" return <div", " if(hidden)return null;return <div"),
    expected: 0,
  },
  {
    name: "fake useRef provider refuses",
    source: BASE_SOURCE.replace(
      "import {useEffect,useRef} from 'react';",
      "import {useEffect} from 'react';const useRef=()=>({current:null});",
    ),
    expected: 0,
  },
];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  resetFilesystemCaches();
});
describe("collectOwnedForeignContainsUses", () => {
  for (const fixture of fixtures)
    it(fixture.name, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "foreign-contains-"));
      roots.push(root);
      const filename = path.join(root, "entry.tsx");
      for (const [relativePath, body] of Object.entries({
        "package.json": JSON.stringify({
          dependencies: { react: "18.2.0", "styled-components": "5.3.11" },
        }),
        ...fixture.files,
        "entry.tsx": fixture.source,
      })) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
      }
      resetFilesystemCaches();
      const result = runRule(probeRule, fixture.source, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.message === "Exact foreign contains argument",
        ),
      ).toHaveLength(fixture.expected);
      expect(
        result.diagnostics.filter((diagnostic) => diagnostic.message === "Strict native ref"),
      ).toHaveLength(0);
    });
});
