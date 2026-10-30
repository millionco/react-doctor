import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { runRule } from "../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "../rules/state-and-effects/no-pass-live-state-to-parent.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFiniteCharacterMapLookup } from "./is-finite-character-map-lookup.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUnmodifiedLocalReactStateCall } from "./is-unmodified-local-react-state-call.js";
import { walkAst } from "./walk-ast.js";

interface CharacterMapCase {
  name: string;
  declaration: string;
  supported: boolean;
}

const component = `import {useCallback,useEffect,useState} from "react";export const Notice=({getLabel})=>{const [choice,setChoice]=useState("first");const [notice,setNotice]=useState("");const readLabel=useCallback(value=>getLabel(value),[getLabel]);useEffect(()=>{setNotice(\`\${readLabel(choice)} selected\`)},[choice,readLabel]);return <button title={translate(notice)} onClick={()=>setChoice("next")}>{notice}</button>};`;

const nativeCharacterMapDeclaration =
  'const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);';

const cases: CharacterMapCase[] = [
  {
    name: "runtime enum provider replacement",
    declaration:
      'enum Patch { Applied = (String.prototype.replace = (pattern, visit) => visit("constructor"), 0) }\nconst translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "runtime namespace provider replacement",
    declaration:
      'namespace Patch { export const applied = (String.prototype.replace = (pattern, visit) => visit("constructor"), 0); }\nconst translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "runtime parameter property initialization",
    declaration:
      'class Patch { constructor(public applied = (String.prototype.replace = (pattern, visit) => visit("constructor"), 0)) {} } new Patch();\nconst translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "finite-two-character-map",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: true,
  },
  {
    name: "unquoted-static-map-keys",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({a:"alpha",b:"beta"})[letter]);',
    supported: true,
  },
  {
    name: "renamed-key",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,character=>({"a":"alpha","b":"beta"})[character]);',
    supported: true,
  },
  {
    name: "wrapped-fresh-map",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>((({"a":"alpha","b":"beta"})[letter])));',
    supported: true,
  },
  {
    name: "unbounded-constructor-key",
    declaration:
      'const translate=input=>String(input).replace(/.+/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "case-folded-key-domain",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/gi,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "negated-key-domain",
    declaration:
      'const translate=input=>String(input).replace(/[^ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "range-key-domain",
    declaration:
      'const translate=input=>String(input).replace(/[a-b]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "escaped-key-domain",
    declaration:
      'const translate=input=>String(input).replace(/[\\u0061b]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "empty-match-quantifier",
    declaration:
      'const translate=input=>String(input).replace(/[ab]*/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "capture-regex",
    declaration:
      'const translate=input=>String(input).replace(/([ab])/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "missing-own-map-key",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha"})[letter]);',
    supported: false,
  },
  {
    name: "computed-map-key",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({["a"]:"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "getter-map-key",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({get a(){return "alpha"},"b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "spread-map",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({...extra,"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "constructor-own-entry",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({"constructor":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "map-alias",
    declaration:
      'const values={"a":"alpha","b":"beta"};const translate=input=>String(input).replace(/[ab]/g,letter=>values[letter]);',
    supported: false,
  },
  {
    name: "key-assignment",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>{letter="constructor";return ({"a":"alpha","b":"beta"})[letter]});',
    supported: false,
  },
  {
    name: "key-escape",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>{observe(letter);return ({"a":"alpha","b":"beta"})[letter]});',
    supported: false,
  },
  {
    name: "map-result-call",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]());',
    supported: false,
  },
  {
    name: "arbitrary-replace-receiver",
    declaration:
      'const translate=input=>input.replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "String-runtime-shadow",
    declaration:
      'const String=value=>value;const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "String-erased-shadow",
    declaration:
      'declare function String(value:unknown):string;const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "String-global-property-write",
    declaration:
      'global.String=value=>value;const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "String-alias-escape",
    declaration:
      'const NativeString=String;export {NativeString};const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "String-prototype-replace-write",
    declaration:
      'String.prototype.replace=(pattern,visit)=>visit("constructor");const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "RegExp-prototype-replace-write",
    declaration:
      'RegExp.prototype[Symbol.replace]=function(value,visit){return visit("constructor")};const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "String-import-remap",
    declaration:
      'import String from "./alternate-string";const translate=input=>String(input).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "callback-alias",
    declaration:
      'const lookup=letter=>({"a":"alpha","b":"beta"})[letter];const translate=input=>String(input).replace(/[ab]/g,lookup);',
    supported: false,
  },
  {
    name: "callback-extra-argument",
    declaration:
      'const translate=input=>String(input).replace(/[ab]/g,(letter,index)=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
  {
    name: "coercion-visible-provider-write",
    declaration:
      'const inputValue={toString(){String.prototype.replace=(pattern,visit)=>visit("constructor");return "a"}};const translate=input=>String(inputValue).replace(/[ab]/g,letter=>({"a":"alpha","b":"beta"})[letter]);',
    supported: false,
  },
];

const prepare = (source: string) => {
  const fixture = parseFixture(source);
  expect(fixture.errors).toEqual([]);
  attachParentReferences(fixture.program);
  const members: EsTreeNode[] = [];
  const stateCalls: EsTreeNode[] = [];
  walkAst(fixture.program, (node) => {
    if (isNodeOfType(node, "MemberExpression") && node.computed) members.push(node);
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "useState"
    )
      stateCalls.push(node);
  });
  expect(members.length).toBeGreaterThan(0);
  expect(stateCalls.length).toBeGreaterThan(0);
  return { program: fixture.program, members, stateCalls, scopes: analyzeScopes(fixture.program) };
};

describe("finite native character-map role", () => {
  it.each(cases)("closes the lookup boundary: $name", ({ declaration, supported }) => {
    const fixture = prepare(`${declaration}\n${component}`);
    const accepted = fixture.members.map((member) =>
      isFiniteCharacterMapLookup(member, fixture.scopes),
    );
    expect(accepted.some(Boolean)).toBe(supported);
    if (supported) {
      expect(accepted.filter(Boolean)).toHaveLength(1);
      const result = runRule(noPassLiveStateToParent, `${declaration}\n${component}`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("keeps the provider option local across warm same-analysis calls", () => {
    const fixture = prepare(`${nativeCharacterMapDeclaration}\n${component}`);
    const initializer = fixture.stateCalls[0];
    expect(initializer).toBeDefined();
    if (!initializer) return;
    expect(isUnmodifiedLocalReactStateCall(initializer, fixture.scopes)).toBe(false);
    expect(
      isUnmodifiedLocalReactStateCall(initializer, fixture.scopes, {
        allowFiniteCharacterMapLookup: true,
      }),
    ).toBe(true);
    expect(isUnmodifiedLocalReactStateCall(initializer, fixture.scopes)).toBe(false);
    expect(
      isUnmodifiedLocalReactStateCall(initializer, fixture.scopes, {
        allowFiniteCharacterMapLookup: true,
      }),
    ).toBe(true);
  });

  it("does not reuse native-provider facts across fresh programs", () => {
    for (const { prefix, supported } of [
      { prefix: "", supported: true },
      { prefix: "globalThis.String = identity;", supported: false },
      { prefix: "", supported: true },
    ]) {
      const fixture = prepare(`${prefix}\n${nativeCharacterMapDeclaration}\n${component}`);
      expect(
        fixture.members.some((member) => isFiniteCharacterMapLookup(member, fixture.scopes)),
      ).toBe(supported);
    }
  });

  it("retains an independent same-callee notification", () => {
    const source = component.replace(
      "setNotice(`${readLabel(choice)} selected`)",
      "setNotice(`${readLabel(choice)} selected`); getLabel(choice)",
    );
    const result = runRule(noPassLiveStateToParent, `${nativeCharacterMapDeclaration}\n${source}`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
