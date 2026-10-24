import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { defineRule } from "../../utils/define-rule.js";
import { getDirectFunctionBindingIdentifier } from "../../utils/get-direct-function-binding-identifier.js";
import { getClosedLocalUtilityCalls } from "../../utils/get-closed-local-utility-calls.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { walkAst } from "../../utils/walk-ast.js";
import { noMutatingArrayMethodOnPropOrHookResult } from "./no-mutating-array-method-on-prop-or-hook-result.js";

interface LocalUtilityCase {
  readonly name: string;
  readonly source: string;
  readonly selectedName: string;
  readonly certificate: boolean;
  readonly warnings: number;
}

const cases: LocalUtilityCase[] = [
  {
    name: "private-request-queue",
    source:
      'function drive() { "use strict"; function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "private-queue-alias",
    source:
      'function drive() { "use strict"; function Drain(request) { const queue = request.items; queue.splice(0, 1); } Drain({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "private-transparent-call",
    source:
      'function drive() { "use strict"; function Drain(request) { request.items.splice(0, 1); } (Drain)({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "private-recursive-with-external-call",
    source:
      'function drive() { "use strict"; function Drain(request) { request.items.splice(0, 1); if (request.again) Drain({ items: [], again: false }); } Drain({ items: [], again: false }); } drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "jsx-escape",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); const node = <Drain items={[]} />; } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "create-element-escape",
    source:
      'import React from "react"; function drive() { function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); React.createElement(Drain, { items: [] }); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "hoc-escape",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); wrap(Drain); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "return-escape",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); return Drain; } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "object-escape",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); return { Drain }; } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "array-dispatch",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } const table = [Drain]; table[0]({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "constant-alias-escape",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } const alias = Drain; alias({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "function-rebind",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain = replacement; Drain({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "optional-call",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain?.({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "member-call",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } Drain.call(null, { items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "constructor-call",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); } new Drain({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "no-use",
    source: "function drive() { function Drain(request) { request.items.splice(0, 1); } } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "self-only",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); Drain(request); } } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "self-create-element",
    source:
      'import React from "react"; function drive() { function Drain(request) { request.items.splice(0, 1); return React.createElement(Drain, request); } Drain({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "arguments-callee-escape",
    source:
      'import React from "react"; function drive() { let saved; function Drain(request) { saved = arguments.callee; request.items.splice(0, 1); } Drain({ items: [] }); return React.createElement(saved, { items: [] }); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "lexical-eval-escape",
    source:
      'function drive() { function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); eval("publish(Drain)"); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "named-expression",
    source:
      "function drive() { const Drain = function Inner(request) { request.items.splice(0, 1); }; Drain({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "top-level-script",
    source: "function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] });",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "inline-export",
    source: "export function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] });",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "export-specifier",
    source:
      "function Drain(request) { request.items.splice(0, 1); } Drain({ items: [] }); export { Drain };",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "genuine-hook-name",
    source:
      'import { useState } from "react"; function drive() { function useDrain(request) { useState(0); request.items.splice(0, 1); } useDrain({ items: [] }); } drive();',
    selectedName: "useDrain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "uppercase-hook-body",
    source:
      'import { useState } from "react"; function drive() { function Drain(request) { useState(0); request.items.splice(0, 1); } Drain({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "jsx-return",
    source:
      "function drive() { function Drain(request) { request.items.splice(0, 1); return <div />; } Drain({ items: [] }); } drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "react-return-annotation",
    source:
      'import type { ReactElement } from "react"; function drive() { function Drain(request): ReactElement | null { request.items.splice(0, 1); return null; } Drain({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "hook-result-remains",
    source:
      'import { useMemo } from "react"; function drive() { function Drain(request) { const items = useMemo(() => request.items, []); items.reverse(); } Drain({ items: [] }); } drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "caps-alpha-rename",
    source: 'function drive(){"use strict";function QX(rows){rows.reverse();}QX([]);}',
    selectedName: "QX",
    certificate: true,
    warnings: 0,
  },
  {
    name: "ordinary-shadowing-independent-identity",
    source:
      'function drive(){"use strict";function Drain(rows){rows.reverse();} function other(){const Drain=()=>null;Drain();} Drain([]);other();}',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "readonly-arrow-unsupported",
    source: "function drive(){const Drain=(rows)=>{rows.sort();};Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "readonly-anonymous-expression-unsupported",
    source: "function drive(){const Drain=function(rows){rows.sort();};Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "self-alias-escape",
    source:
      "function drive(){function Drain(rows){const alias=Drain;rows.sort();return alias;}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "self-reassignment",
    source: "function drive(){function Drain(rows){Drain=()=>null;rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "renamed-genuine-hook-body",
    source:
      'import {useState as state} from "react";function drive(){function Drain(rows){state(0);rows.sort();}Drain([]);}',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "react-node-return-type",
    source:
      'import type {ReactNode} from "react";function drive(){function Drain(rows):ReactNode{rows.sort();return null;}Drain([]);}',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "typed-parameter-ordinary-utility",
    source: 'function drive(){"use strict";function Drain(rows:string[]){rows.sort();}Drain([]);}',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "own-this-escape",
    source: "function drive(){function Drain(rows){publish(this);rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "lexical-arrow-arguments-escape",
    source:
      "function drive(){function Drain(rows){const expose=()=>arguments;publish(expose);rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "capture-caller-escape",
    source:
      "function drive(){function capture(){return capture.caller;}function Drain(rows){publish(capture());rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "computed-local-function-capability",
    source:
      "function drive(key){function capture(){return null;}function Drain(rows){publish(capture[key]);rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "computed-function-destructure-capability",
    source:
      "function drive(key){function capture(){return null;}function Drain(rows){const {[key]:value}=capture;publish(value);rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "ambient-eval-shadow",
    source:
      'declare const eval:(code:string)=>unknown;function drive(){function Drain(rows){rows.sort();}Drain([]);eval("publish(Drain)");}',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "primitive-return-annotation-unsupported",
    source: "function drive(){function Drain(rows):void{rows.sort();}Drain([]);}",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "program-exact-double-quoted-directive",
    source: '"use strict";function drive(){function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "program-exact-single-quoted-directive",
    source: "'use strict';function drive(){function Drain(rows){rows.sort();}Drain([]);}drive();",
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "selected-own-strict-directive",
    source: 'function drive(){function Drain(rows){"use strict";rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "strict-directive-after-other-directive",
    source:
      '"other directive";"use strict";function drive(){function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: true,
    warnings: 0,
  },
  {
    name: "sloppy-scope-remains-unsupported",
    source: "function drive(){function Drain(rows){rows.sort();}Drain([]);}drive();",
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "late-program-string-is-not-directive",
    source: '0;"use strict";function drive(){function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "late-function-string-is-not-directive",
    source: 'function drive(){0;"use strict";function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "parenthesized-string-is-not-directive",
    source: 'function drive(){("use strict");function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "ordinary-block-string-is-not-strict-scope",
    source: 'function drive(){{"use strict";function Drain(rows){rows.sort();}Drain([]);}}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "escaped-directive-is-not-strict",
    source:
      'function drive(){"\\u0075se strict";function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "line-continuation-directive-is-not-strict",
    source:
      'function drive(){"use \\\nstrict";function Drain(rows){rows.sort();}Drain([]);}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "sloppy-reflective-caller-escape",
    source:
      'function drive(){let saved;function capture(){return Reflect.get(capture,"caller");}function Drain(rows){saved=capture();rows.sort();}Drain([]);return React.createElement(saved,{items:[]});}drive();',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
];

const strictControlNames = new Set([
  "jsx-escape",
  "create-element-escape",
  "hoc-escape",
  "return-escape",
  "object-escape",
  "array-dispatch",
  "constant-alias-escape",
  "function-rebind",
  "optional-call",
  "member-call",
  "constructor-call",
  "no-use",
  "self-only",
  "self-create-element",
  "genuine-hook-name",
  "uppercase-hook-body",
  "jsx-return",
  "react-return-annotation",
  "hook-result-remains",
  "self-alias-escape",
  "self-reassignment",
  "renamed-genuine-hook-body",
  "react-node-return-type",
  "own-this-escape",
  "lexical-arrow-arguments-escape",
  "capture-caller-escape",
  "computed-local-function-capability",
  "computed-function-destructure-capability",
]);
const strictControls: LocalUtilityCase[] = cases
  .filter((candidate) => strictControlNames.has(candidate.name))
  .map((candidate) => ({
    ...candidate,
    name: `strict-${candidate.name}`,
    source: `"use strict";${candidate.source}`,
  }));
strictControls.push(
  {
    name: "strict-props-children-render-evidence",
    source:
      'function drive(){"use strict";function Drain(props){props.items.sort();return props.children;}Drain({items:[],children:null});}',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
  {
    name: "strict-destructured-children-render-evidence",
    source:
      'function drive(){"use strict";function Drain({items,children}){items.sort();return children;}Drain({items:[],children:null});}',
    selectedName: "Drain",
    certificate: false,
    warnings: 1,
  },
);

describe("closed local utility parameter roles", () => {
  it.each([...cases, ...strictControls])(
    "$name",
    ({ source, selectedName, certificate, warnings }) => {
      let didCertify = false;
      const probe = defineRule({
        id: "closed-local-utility-probe",
        title: "Closed local utility probe",
        severity: "warn",
        recommendation: "Probe the selected callable role.",
        create: (context) => ({
          Program: (program) => {
            walkAst(program, (node) => {
              if (
                isFunctionLike(node) &&
                getDirectFunctionBindingIdentifier(node)?.name === selectedName &&
                getClosedLocalUtilityCalls(node, context)
              )
                didCertify = true;
            });
          },
        }),
      });
      const proof = runRule(probe, source);
      expect(proof.parseErrors).toEqual([]);
      expect(didCertify).toBe(certificate);
      const result = runRule(noMutatingArrayMethodOnPropOrHookResult, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(warnings);
    },
  );
});

it("keeps declaration-only and with syntax outside the certificate", () => {
  const source = "function drive(){function Drain(rows){rows.sort();}with(scope){Drain([]);}}";
  let didCertify = false;
  const probe = defineRule({
    id: "closed-local-utility-with-probe",
    title: "With boundary",
    severity: "warn",
    recommendation: "Keep dynamic scopes unsupported.",
    create: (context) => ({
      FunctionDeclaration: (node) => {
        if (node.id?.name === "Drain" && getClosedLocalUtilityCalls(node, context))
          didCertify = true;
      },
    }),
  });
  runRule(probe, source, { filename: "fixture.cjs" });
  expect(didCertify).toBe(false);
  expect(
    runRule(
      noMutatingArrayMethodOnPropOrHookResult,
      "declare function Drain(rows: string[]): void;",
    ).diagnostics,
  ).toEqual([]);
});
