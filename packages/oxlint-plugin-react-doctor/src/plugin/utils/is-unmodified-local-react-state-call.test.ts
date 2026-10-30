import { describe, expect, it, vi } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import {
  LOCAL_REACT_STATE_LARGE_CALL_COUNT,
  LOCAL_REACT_STATE_MAXIMUM_LOOKUP_SCALING_MULTIPLIER,
  LOCAL_REACT_STATE_SMALL_CALL_COUNT,
} from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isUnmodifiedLocalReactStateCall } from "./is-unmodified-local-react-state-call.js";
import { parseSourceText } from "./parse-source-file.js";
import { walkAst } from "./walk-ast.js";

interface LocalReactStateWork {
  lookups: number;
  inspectedProviderReferences: number;
}

const providerWork = vi.hoisted(() => ({ inspectedReferences: 0 }));

vi.mock("./is-non-escaping-react-api-reference.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./is-non-escaping-react-api-reference.js")>();
  return {
    ...original,
    isNonEscapingReactApiReference: (expression: EsTreeNode): boolean => {
      providerWork.inspectedReferences += 1;
      return original.isNonEscapingReactApiReference(expression);
    },
  };
});

const prepare = (sourceText: string) => {
  const program = parseSourceText({ filename: "local-state.tsx", sourceText });
  if (!program) throw new Error("Expected parsed source");
  const scopes = analyzeScopes(program);
  const calls: EsTreeNode[] = [];
  walkAst(program, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      !(isNodeOfType(node.callee, "Identifier") && node.callee.name === "require")
    )
      calls.push(node);
  });
  return { program, scopes, calls };
};

const measureLookups = (callCount: number, namespace: boolean): LocalReactStateWork => {
  const source = namespace ? 'import React from "react";' : 'import {useState} from "react";';
  const callee = namespace ? "React.useState" : "useState";
  const { scopes, calls } = prepare(
    source +
      Array.from({ length: callCount }, (_, index) => `const stored${index} = ${callee}(0);`).join(
        "\n",
      ),
  );
  providerWork.inspectedReferences = 0;
  let lookups = 0;
  const observedScopes = {
    ...scopes,
    symbolFor: (identifier: Parameters<typeof scopes.symbolFor>[0]) => {
      lookups += 1;
      return scopes.symbolFor(identifier);
    },
  };
  expect(calls).toHaveLength(callCount);
  for (const call of calls)
    expect(isUnmodifiedLocalReactStateCall(call, observedScopes)).toBe(true);
  return { lookups, inspectedProviderReferences: providerWork.inspectedReferences };
};

describe("local React state provider facts", () => {
  it.each([false, true])("bounds repeated provider work for namespace=$0", (namespace) => {
    const small = measureLookups(LOCAL_REACT_STATE_SMALL_CALL_COUNT, namespace);
    const large = measureLookups(LOCAL_REACT_STATE_LARGE_CALL_COUNT, namespace);
    expect(small.lookups).toBeGreaterThan(0);
    expect(small.inspectedProviderReferences).toBeGreaterThan(0);
    expect(large.lookups).toBeLessThan(
      small.lookups * LOCAL_REACT_STATE_MAXIMUM_LOOKUP_SCALING_MULTIPLIER,
    );
    expect(large.inspectedProviderReferences).toBeLessThan(
      small.inspectedProviderReferences * LOCAL_REACT_STATE_MAXIMUM_LOOKUP_SCALING_MULTIPLIER,
    );
  });

  it("keeps the allowed require node separate from imported call proofs", () => {
    const { scopes, calls } = prepare(
      'import {useState} from "react";const React=require("react");const first=useState(0);const second=React.useState(1);',
    );
    expect(calls).toHaveLength(2);
    expect(isUnmodifiedLocalReactStateCall(calls[0], scopes)).toBe(false);
    expect(isUnmodifiedLocalReactStateCall(calls[1], scopes)).toBe(true);
    expect(isUnmodifiedLocalReactStateCall(calls[0], scopes)).toBe(false);
  });

  it("keeps initializer ordering outside the memoized provider proof", () => {
    const { scopes, calls } = prepare(
      'React.useState(0);const React=require("react");React.useState(1);',
    );
    expect(calls).toHaveLength(2);
    expect(isUnmodifiedLocalReactStateCall(calls[0], scopes)).toBe(false);
    expect(isUnmodifiedLocalReactStateCall(calls[1], scopes)).toBe(true);
  });

  it("does not reuse a valid provider proof for an unsupported call shape", () => {
    const { scopes, calls } = prepare(
      'import React from "react";React.useState(0);React.namespace.useState(0);React.useRef(0);React["useState"](0);',
    );
    expect(calls.map((call) => isUnmodifiedLocalReactStateCall(call, scopes))).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });

  it("keeps numeric-data permission separate in both query orders", () => {
    for (const firstMode of [false, true]) {
      const { scopes, calls } = prepare(
        'import {useState} from "react";export const Panel=input=>{const [stored]=useState(7);const values=[3,7];const getKey=()=>Number(input);const total=values[getKey()];return <span>{stored+total}</span>};',
      );
      const stateCall = calls.find(
        (call) =>
          isNodeOfType(call, "CallExpression") &&
          isNodeOfType(call.callee, "Identifier") &&
          call.callee.name === "useState",
      );
      if (!stateCall) throw new Error("Expected state call");
      for (const mode of [firstMode, !firstMode, firstMode]) {
        expect(
          isUnmodifiedLocalReactStateCall(stateCall, scopes, { allowNumericDataAccess: mode }),
        ).toBe(mode);
      }
    }
  });

  it("does not carry a safe proof into a fresh hazardous program", () => {
    for (const mutation of ["", "React.__defineGetter__('useState',()=>customState);", ""]) {
      const { scopes, calls } = prepare(
        'import React from "react";' + mutation + "React.useState(0);",
      );
      const stateCall = calls[calls.length - 1];
      expect(isUnmodifiedLocalReactStateCall(stateCall, scopes)).toBe(!mutation);
      const freshScopes = analyzeScopes(scopes.rootScope.node);
      expect(isUnmodifiedLocalReactStateCall(stateCall, freshScopes)).toBe(!mutation);
    }
  });
});

describe("combined local provider policy cache", () => {
  it.each([false, true])(
    "keeps numeric, finite-map and validator permissions separate in reverse=$0",
    (reverseOrder) => {
      const { scopes, calls } = prepare(
        'import {useState} from "react";const translate=input=>String(input).replace(/[ab]/g,letter=>({a:"alpha",b:"beta"})[letter]);export const Panel=input=>{const [stored]=useState(7);const values=[3,7];const getKey=()=>Number(input);const total=values[getKey()];Object.keys({});return <span>{stored+total+translate(input)}</span>};',
      );
      const stateCall = calls.find(
        (call) =>
          isNodeOfType(call, "CallExpression") &&
          isNodeOfType(call.callee, "Identifier") &&
          call.callee.name === "useState",
      );
      if (!stateCall) throw new Error("Expected state call");
      let acceptsObjectReference = true;
      const validator = (node: EsTreeNode): boolean =>
        acceptsObjectReference && isNodeOfType(node, "Identifier") && node.name === "Object";
      const modes = reverseOrder ? [true, false] : [false, true];
      for (const allowNumericDataAccess of modes) {
        for (const allowFiniteCharacterMapLookup of modes) {
          expect(
            isUnmodifiedLocalReactStateCall(stateCall, scopes, {
              allowNumericDataAccess,
              allowFiniteCharacterMapLookup,
              propTypesObjectValidator: validator,
              propTypesObjectValidatorGeneration: 0,
            }),
          ).toBe(allowNumericDataAccess && allowFiniteCharacterMapLookup);
        }
      }
      acceptsObjectReference = false;
      expect(
        isUnmodifiedLocalReactStateCall(stateCall, scopes, {
          allowNumericDataAccess: true,
          allowFiniteCharacterMapLookup: true,
          propTypesObjectValidator: validator,
          propTypesObjectValidatorGeneration: 1,
        }),
      ).toBe(false);
      acceptsObjectReference = true;
      expect(
        isUnmodifiedLocalReactStateCall(stateCall, scopes, {
          allowNumericDataAccess: true,
          allowFiniteCharacterMapLookup: true,
          propTypesObjectValidator: validator,
          propTypesObjectValidatorGeneration: 2,
        }),
      ).toBe(true);
      expect(
        isUnmodifiedLocalReactStateCall(stateCall, scopes, {
          allowNumericDataAccess: true,
          allowFiniteCharacterMapLookup: true,
          propTypesObjectValidator: () => false,
          propTypesObjectValidatorGeneration: 2,
        }),
      ).toBe(false);
      expect(
        isUnmodifiedLocalReactStateCall(stateCall, scopes, {
          allowNumericDataAccess: true,
          allowFiniteCharacterMapLookup: true,
        }),
      ).toBe(false);
      for (const acceptsReference of [false, true, false]) {
        acceptsObjectReference = acceptsReference;
        expect(
          isUnmodifiedLocalReactStateCall(stateCall, scopes, {
            allowNumericDataAccess: true,
            allowFiniteCharacterMapLookup: true,
            propTypesObjectValidator: validator,
          }),
        ).toBe(acceptsReference);
      }
    },
  );
});
