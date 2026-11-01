import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { containsNativeRefInitializer } from "../../utils/contains-native-ref-initializer.js";
import { containsImportedValueCall } from "../../utils/contains-imported-value-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

interface NativeRefInitializerCase {
  name: string;
  code: string;
  expectedCount: number;
  expectedNativeRefInitializer?: boolean;
}

const nativeRefInitializerCases: ReadonlyArray<NativeRefInitializerCase> = [
  {
    name: "named-ref-object",
    code: "import { useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "renamed-named-ref",
    code: "import { useRef as makeRef } from 'react'; function Panel(){ const slots={primary:makeRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "named-ref-array",
    code: "import { useRef } from 'react'; function Panel(){ const slots=[useRef(null),useRef(null)]; return <div ref={slots[0]}/>; }",
    expectedCount: 0,
  },
  {
    name: "nested-hook-member",
    code: "import { useRef } from 'react'; function Panel(){ const slots={group:{primary:useRef(null)}}; return <div ref={slots.group.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "ordinary-literal",
    code: "function Panel(){ const labels=['open','closed']; return <List values={labels}/>; }",
    expectedCount: 1,
  },
  {
    name: "ordinary-imported-call",
    code: "import { makeLabel } from './labels'; function Panel(){ const labels=[makeLabel()]; return <List values={labels}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "foreign-hook-spelling",
    code: "import { useRef } from './factory'; function Panel(){ const slots={primary:useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "type-only-import",
    code: "import type { useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 1,
  },
  {
    name: "parameter-shadow",
    code: "function Panel({useRef}){ const slots={primary:useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 0,
  },
  {
    name: "already-local-ref",
    code: "import { useRef } from 'react'; function Panel(){ const primary=useRef(null); const slots={primary}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "deferred-inline-call",
    code: "import { useRef } from 'react'; function Panel(){ const slots={later:()=>useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 0,
  },
  {
    name: "namespace-deferred-first-profile",
    code: "import React from 'react'; function Panel(){ const slots={primary:React.useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 1,
  },
  {
    name: "selected-binding-pattern-write",
    code: "import { useRef as makeRef } from 'react'; [makeRef]=[makeStatic]; function Panel(){ const slots={primary:makeRef(null)}; return <List values={slots}/>; }",
    expectedCount: 1,
  },
  {
    name: "visible-provider-replacement",
    code: "import React,{useRef} from 'react'; React.useRef=makeStatic; function Panel(){ const slots={primary:useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "ordinary-default-react-import",
    code: "import React,{useRef} from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "same-name-local-function",
    code: "const useRef=()=>null; function Panel(){ const slots={primary:useRef(null)}; return <List values={slots}/>; }",
    expectedCount: 1,
  },
  {
    name: "inline-type-import",
    code: "import { type useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 1,
  },
  {
    name: "unused-namespace-provider",
    code: "import * as React from 'react'; import { useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "unused-default-as-provider",
    code: "import {default as React,useRef} from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "type-only-default-provider",
    code: "import type React from 'react'; import { useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "namespace-type-reference",
    code: "import React,{useRef} from 'react'; type ElementType=React.ReactNode; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "namespace-alias-escape",
    code: "import React,{useRef} from 'react'; const carrier=React; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "namespace-argument-escape",
    code: "import React,{useRef} from 'react'; consume(React); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "namespace-explicit-read-deferred",
    code: "import React,{useRef} from 'react'; const factory=React.createElement; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "namespace-pattern-write",
    code: "import React,{useRef} from 'react'; ({useRef:React.useRef}=replacement); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "selected-ordinary-write",
    code: "import { useRef } from 'react'; useRef=makeStatic; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 1,
  },
  {
    name: "selected-object-pattern-write",
    code: "import { useRef } from 'react'; ({useRef}=replacement); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 1,
  },
  {
    name: "selected-loop-target-write",
    code: "import { useRef } from 'react'; for(useRef of replacements){} function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 1,
  },
  {
    name: "selected-nested-write",
    code: "import { useRef } from 'react'; const replace=()=>{useRef=makeStatic}; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 1,
  },
  {
    name: "selected-provider-escape",
    code: "import { useRef } from 'react'; consume(useRef); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "selected-call-method-deferred",
    code: "import { useRef } from 'react'; useRef.call(null,null); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "selected-type-reference",
    code: "import { useRef } from 'react'; type RefFactory=typeof useRef; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "conditional-hook-call-deferred",
    code: "import { useRef } from 'react'; function Panel(){const slots={primary:false&&useRef(null)}; return <List values={slots}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "wrapped-argument-hook-deferred",
    code: "import { useRef } from 'react'; import {wrap} from './wrap'; function Panel(){const slots={primary:wrap(useRef(null))}; return <List values={slots}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "computed-hook-key-deferred",
    code: "import { useRef } from 'react'; function Panel(){const slots={[useRef(null)]:null}; return <List values={slots}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "spread-call-arguments-deferred",
    code: "import { useRef } from 'react'; function Panel(){const slots={primary:useRef(...[])}; return <List values={slots}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "optional-hook-call-deferred",
    code: "import { useRef } from 'react'; function Panel(){const slots={primary:useRef?.(null)}; return <List values={slots}/>;}",
    expectedCount: 1,
  },
  {
    name: "transparent-hook-callee",
    code: "import { useRef } from 'react'; function Panel(){const slots={primary:(useRef as typeof useRef)(null)}; return <div ref={slots.primary}/>;}",
    expectedCount: 0,
  },
  {
    name: "transparent-hook-value",
    code: "import { useRef } from 'react'; function Panel(){const slots={primary:(useRef(null) as unknown)}; return <List values={slots}/>;}",
    expectedCount: 0,
  },
  {
    name: "native-other-hook-deferred",
    code: "import {useState} from 'react'; function Panel(){const slots={primary:useState(null)}; return <List values={slots}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "global-react-provider-exposure",
    code: "import { useRef } from 'react'; void globalThis.React; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "global-require-provider",
    code: "import { useRef } from 'react'; void require; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "dynamic-react-provider",
    code: "import { useRef } from 'react'; const replacement=import('react'); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "builtin-module-loader",
    code: "import {createRequire} from 'node:module'; import { useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "type-only-builtin-loader",
    code: "import type {Module} from 'node:module'; import { useRef } from 'react'; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "direct-global-eval",
    code: "import { useRef } from 'react'; void eval; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "qualified-global-function",
    code: "import { useRef } from 'react'; void globalThis.Function; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "static-constructor-projection",
    code: "import { useRef } from 'react'; const loader=Object.constructor; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "static-prototype-projection",
    code: "import { useRef } from 'react'; const carrier=holder.__proto__; function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "shadowed-function-provider",
    code: "import { useRef } from 'react'; const Function=(value)=>value; Function('ordinary'); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "shadowed-react-provider",
    code: "import { useRef } from 'react'; const React={label:'local'}; consume(React); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "ordinary-browser-log",
    code: "import { useRef } from 'react'; window.console.log('ready'); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "runtime-type-import-only",
    code: "import { useRef } from 'react'; type Runtime=typeof import('react'); function Panel(){ const slots={primary:useRef(null)}; return <div ref={slots.primary}/>; }",
    expectedCount: 0,
  },
  {
    name: "custom-hook-deferred",
    code: "import {useSlots} from './slots'; function Panel(){const slots={primary:useSlots()}; return <List values={slots}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "existing-impure-initializer",
    code: "function Panel(){const labels={seed:Date.now()}; return <List values={labels}/>;}",
    expectedCount: 0,
  },
  {
    name: "existing-mutated-literal",
    code: "function Panel(){const labels=['open']; labels.push('closed'); return <List values={labels}/>;}",
    expectedCount: 0,
  },
  {
    name: "type-only-namespace-runtime-write",
    code: "import type React from 'react'; import {useRef} from 'react'; React.useRef=makeStatic; function Panel(){const slots={primary:useRef(null)}; return <div ref={slots.primary}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "type-only-global-carrier-runtime-use",
    code: "import type {Function} from './types'; import {useRef} from 'react'; void Function; function Panel(){const slots={primary:useRef(null)}; return <div ref={slots.primary}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "type-only-module-runtime-use",
    code: "import type {createRequire} from 'node:module'; import {useRef} from 'react'; void createRequire; function Panel(){const slots={primary:useRef(null)}; return <div ref={slots.primary}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "constructor-pattern-extraction",
    code: "import {useRef} from 'react'; const {constructor: factory}=holder; void factory; function Panel(){const slots={primary:useRef(null)}; return <div ref={slots.primary}/>;}",
    expectedCount: 0,
    expectedNativeRefInitializer: false,
  },
  {
    name: "nonconstructor-pattern-extraction",
    code: "import {useRef} from 'react'; const {label: selected}=holder; void selected; function Panel(){const slots={primary:useRef(null)}; return <div ref={slots.primary}/>;}",
    expectedCount: 0,
  },
];

describe("prefer-module-scope-static-value native ref initializers", () => {
  for (const testCase of nativeRefInitializerCases) {
    it(testCase.name, () => {
      const result = runRule(preferModuleScopeStaticValue, testCase.code, {
        filename: "independent-hook-literal.tsx",
        forceJsx: true,
        includeLocations: true,
        settings: {
          "react-doctor": {
            portedRuleMode: "curated",
            capabilities: ["react", "typescript"],
          },
        },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
      if (testCase.expectedNativeRefInitializer !== undefined) {
        const parsed = parseFixture(testCase.code, {
          filename: "independent-hook-literal.tsx",
          forceJsx: true,
        });
        expect(parsed.errors).toEqual([]);
        attachParentReferences(parsed.program);
        const scopes = analyzeScopes(parsed.program);
        let checkedInitializers = 0;
        walkAst(parsed.program, (node) => {
          if (
            !isNodeOfType(node, "VariableDeclarator") ||
            !isNodeOfType(node.id, "Identifier") ||
            (node.id.name !== "slots" && node.id.name !== "labels") ||
            !node.init
          )
            return;
          expect(containsNativeRefInitializer(node.init, scopes)).toBe(
            testCase.expectedNativeRefInitializer,
          );
          expect(containsImportedValueCall(node.init, scopes)).toBe(true);
          checkedInitializers++;
        });
        expect(checkedInitializers).toBe(1);
      }
    });
  }
});
