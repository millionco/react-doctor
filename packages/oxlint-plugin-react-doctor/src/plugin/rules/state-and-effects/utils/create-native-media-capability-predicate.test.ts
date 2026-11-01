import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { Rule } from "../../../utils/rule.js";
import { createNativeMediaCapabilityPredicate } from "./create-native-media-capability-predicate.js";
import {
  NATIVE_MEDIA_SMALL_COMPONENT_COUNT,
  NATIVE_MEDIA_LARGE_COMPONENT_COUNT,
  NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
} from "./effect/constants.js";

interface MediaPredicateProbeInput {
  readonly onLookup?: () => void;
  readonly invocationCount?: number;
  readonly evaluateMediaCalls?: boolean;
  readonly onPredicateMatch?: (matched: boolean) => void;
}

const providerWork = vi.hoisted(() => ({
  inspectedReferences: 0,
  visitedNodes: 0,
  inspectedBindings: 0,
  receiverVisits: 0,
}));
vi.mock("../../../utils/find-transparent-expression-root.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../utils/find-transparent-expression-root.js")>();
  return {
    ...original,
    findTransparentExpressionRoot: (node: EsTreeNode) => {
      if (isNodeOfType(node, "Identifier") && ["probe", "receiver"].includes(node.name))
        providerWork.receiverVisits += 1;
      return original.findTransparentExpressionRoot(node);
    },
  };
});
vi.mock("../../../utils/walk-ast.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../utils/walk-ast.js")>();
  return {
    ...original,
    walkAst: (node: EsTreeNode, visitor: Parameters<typeof original.walkAst>[1]) =>
      original.walkAst(node, (child) => {
        providerWork.visitedNodes += 1;
        return visitor(child);
      }),
  };
});
vi.mock("../../../utils/is-binding-assignment-target.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../utils/is-binding-assignment-target.js")>();
  return {
    ...original,
    isBindingAssignmentTarget: (node: EsTreeNode): boolean => {
      providerWork.inspectedBindings += 1;
      return original.isBindingAssignmentTarget(node);
    },
  };
});
vi.mock("../../../utils/is-non-escaping-react-api-reference.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../utils/is-non-escaping-react-api-reference.js")>();
  return {
    ...original,
    isNonEscapingReactApiReference: (expression: EsTreeNode): boolean => {
      providerWork.inspectedReferences += 1;
      return original.isNonEscapingReactApiReference(expression);
    },
  };
});

const createMediaPredicateProbe = ({
  onLookup,
  invocationCount = 1,
  evaluateMediaCalls = false,
  onPredicateMatch,
}: MediaPredicateProbeInput = {}): Rule => ({
  id: "native-media-predicate-probe",
  severity: "warn",
  create: (context) => {
    const adapted = {
      ...context,
      scopes: {
        ...context.scopes,
        symbolFor: (identifier: Parameters<typeof context.scopes.symbolFor>[0]) => {
          onLookup?.();
          return context.scopes.symbolFor(identifier);
        },
        isGlobalReference: (identifier: Parameters<typeof context.scopes.isGlobalReference>[0]) => {
          onLookup?.();
          return context.scopes.isGlobalReference(identifier);
        },
      },
    };
    return {
      CallExpression: (node) => {
        const name = isNodeOfType(node.callee, "Identifier")
          ? node.callee.name
          : getStaticPropertyName(node.callee);
        if (name !== "useEffect" && name !== "useMemo") return;
        const owner = findEnclosingFunction(node);
        const callback = node.arguments[0];
        if (
          !isNodeOfType(owner, "ArrowFunctionExpression") ||
          !isNodeOfType(owner.body, "BlockStatement") ||
          !callback
        )
          return;
        const declaration = owner.body.body[0];
        if (!isNodeOfType(declaration, "VariableDeclaration")) return;
        const stateDeclarator = declaration.declarations[0];
        if (!stateDeclarator) return;
        const mediaCalls: EsTreeNode[] = [];
        if (evaluateMediaCalls) {
          walkAst(callback, (current) => {
            if (
              isNodeOfType(current, "CallExpression") &&
              isNodeOfType(current.callee, "MemberExpression") &&
              getStaticPropertyName(current.callee) === "canPlayType"
            )
              mediaCalls.push(current);
          });
        }
        let predicate: ReturnType<typeof createNativeMediaCapabilityPredicate> = null;
        let allMatched = true;
        for (let index = 0; index < invocationCount; index += 1) {
          predicate = createNativeMediaCapabilityPredicate({
            context: adapted,
            effectNode: node,
            effectFunction: callback,
            stateDeclarator,
          });
          if (evaluateMediaCalls) {
            const expression = mediaCalls[index];
            const matched = Boolean(expression && predicate?.(expression));
            onPredicateMatch?.(matched);
            allMatched = matched && allMatched;
          }
        }
        context.report({ node, message: String(Boolean(predicate) && allMatched) });
      },
    };
  },
});

describe("native media provider facts", () => {
  it("bounds equivalent receiver aliases within one callback", () => {
    const measurements = [
      NATIVE_MEDIA_SMALL_COMPONENT_COUNT,
      NATIVE_MEDIA_LARGE_COMPONENT_COUNT,
    ].map((writeCount) => {
      const aliases = Array.from(
        { length: writeCount },
        (_, index) => `const receiver${index}=probe;`,
      ).join("");
      const conditions = Array.from(
        { length: writeCount },
        (_, index) => `if(receiver${index}.canPlayType("video/example"))setAcceptedKey(sourceKey);`,
      ).join("");
      const source =
        'import {useState,useEffect} from "react";const Panel=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=useState(null);useEffect(()=>{const probe=document.createElement("video");' +
        aliases +
        conditions +
        "},[sourceKey]);return acceptedKey;};";
      providerWork.receiverVisits = 0;
      const result = runRule(
        createMediaPredicateProbe({ invocationCount: writeCount, evaluateMediaCalls: true }),
        source,
        { filename: "aliased-media-receiver.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["true"]);
      return providerWork.receiverVisits;
    });
    expect(measurements[0]).toBeGreaterThan(0);
    expect(measurements[1]).toBeLessThan(
      measurements[0] * NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
    );
  });

  it.each([false, true])(
    "keeps distinct safe and escaped receiver groups separate for reversed=$0",
    (reversed) => {
      const conditions = [
        'if(receiver.canPlayType("video/example"))setAcceptedKey(sourceKey);',
        'if(other.canPlayType("video/example"))setAcceptedKey(sourceKey);',
      ];
      if (reversed) conditions.reverse();
      const source =
        'import {useState,useEffect} from "react";const Panel=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=useState(null);useEffect(()=>{const probe=document.createElement("video");const receiver=probe;const other=document.createElement("video");consume(other);' +
        conditions.join("") +
        "},[sourceKey]);return acceptedKey;};";
      const actual: boolean[] = [];
      const expected = [true, false];
      if (reversed) expected.reverse();
      const result = runRule(
        createMediaPredicateProbe({
          invocationCount: expected.length,
          evaluateMediaCalls: true,
          onPredicateMatch: (matched) => actual.push(matched),
        }),
        source,
        { filename: "separate-media-receivers.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(actual).toEqual(expected);
    },
  );

  it("bounds shared receiver reference work for every returned predicate", () => {
    const measurements = [
      NATIVE_MEDIA_SMALL_COMPONENT_COUNT,
      NATIVE_MEDIA_LARGE_COMPONENT_COUNT,
    ].map((writeCount) => {
      const source =
        'import {useState,useEffect} from "react";const Panel=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=useState(null);useEffect(()=>{const probe=document.createElement("video");const receiver=probe;' +
        Array.from(
          { length: writeCount },
          () => 'if(receiver.canPlayType("video/example"))setAcceptedKey(sourceKey);',
        ).join("") +
        "},[sourceKey]);return acceptedKey;};";
      providerWork.receiverVisits = 0;
      const result = runRule(
        createMediaPredicateProbe({ invocationCount: writeCount, evaluateMediaCalls: true }),
        source,
        { filename: "shared-media-receiver.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["true"]);
      return providerWork.receiverVisits;
    });
    expect(measurements[0]).toBeGreaterThan(0);
    expect(measurements[1]).toBeLessThan(
      measurements[0] * NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
    );
  });

  it("bounds repeated writes within one media effect", () => {
    const measurements = [
      NATIVE_MEDIA_SMALL_COMPONENT_COUNT,
      NATIVE_MEDIA_LARGE_COMPONENT_COUNT,
    ].map((writeCount) => {
      const source =
        'import {useState,useEffect} from "react";const Panel=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=useState(null);useEffect(()=>{if(document.createElement("video").canPlayType("video/example")){' +
        Array.from({ length: writeCount }, () => "setAcceptedKey(sourceKey);").join("") +
        "}},[sourceKey]);return acceptedKey;};";
      providerWork.visitedNodes = 0;
      providerWork.inspectedBindings = 0;
      const result = runRule(createMediaPredicateProbe({ invocationCount: writeCount }), source, {
        filename: "many-media-writes.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["true"]);
      return {
        visitedNodes: providerWork.visitedNodes,
        inspectedBindings: providerWork.inspectedBindings,
      };
    });
    expect(measurements[0].visitedNodes).toBeGreaterThan(0);
    expect(measurements[0].inspectedBindings).toBeGreaterThan(0);
    expect(measurements[1].visitedNodes).toBeLessThan(
      measurements[0].visitedNodes * NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
    );
    expect(measurements[1].inspectedBindings).toBeLessThan(
      measurements[0].inspectedBindings * NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
    );
  });

  it.each([false, true])(
    "bounds repeated program and provider work for namespace=$0",
    (namespace) => {
      const measurements = [
        NATIVE_MEDIA_SMALL_COMPONENT_COUNT,
        NATIVE_MEDIA_LARGE_COMPONENT_COUNT,
      ].map((componentCount) => {
        const prefix = namespace ? "React." : "";
        const header = namespace
          ? 'import * as React from "react";'
          : 'import {useState,useEffect} from "react";';
        const source =
          header +
          Array.from(
            { length: componentCount },
            (_, index) =>
              `const MediaPanel${index}=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=${prefix}useState(null);${prefix}useEffect(()=>{if(document.createElement("video").canPlayType("video/example"))setAcceptedKey(sourceKey);},[sourceKey]);return acceptedKey;};`,
          ).join("\n");
        let lookups = 0;
        providerWork.inspectedReferences = 0;
        const result = runRule(
          createMediaPredicateProbe({
            onLookup: () => {
              lookups += 1;
            },
          }),
          source,
          { filename: "media-panel.tsx" },
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(componentCount);
        expect(result.diagnostics.every((diagnostic) => diagnostic.message === "true")).toBe(true);
        return { lookups, inspectedReferences: providerWork.inspectedReferences };
      });
      expect(measurements[0].lookups).toBeGreaterThan(0);
      expect(measurements[0].inspectedReferences).toBeGreaterThan(0);
      expect(measurements[1].lookups).toBeLessThan(
        measurements[0].lookups * NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
      );
      expect(measurements[1].inspectedReferences).toBeLessThan(
        measurements[0].inspectedReferences *
          NATIVE_MEDIA_MAXIMUM_PROVIDER_LOOKUP_GROWTH_MULTIPLIER,
      );
    },
  );

  it("checks every effect callback after a shared provider proof", () => {
    const source =
      'import {useState,useEffect} from "react";const Panel=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=useState(null);useEffect(()=>{if(document.createElement("video").canPlayType("video/example"))setAcceptedKey(sourceKey);},[sourceKey]);useEffect(async()=>{if(document.createElement("video").canPlayType("video/example"))setAcceptedKey(sourceKey);},[sourceKey]);return acceptedKey;};';
    const result = runRule(createMediaPredicateProbe(), source, { filename: "media-panel.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["true", "false"]);
  });

  it("checks each namespace API name before reusing the effect provider proof", () => {
    const source =
      'import * as React from "react";const Panel=({sourceKey})=>{const [acceptedKey,setAcceptedKey]=React.useState(null);React.useEffect(()=>{if(document.createElement("video").canPlayType("video/example"))setAcceptedKey(sourceKey);},[sourceKey]);React.useMemo(()=>{if(document.createElement("video").canPlayType("video/example"))setAcceptedKey(sourceKey);},[sourceKey]);return acceptedKey;};';
    const result = runRule(createMediaPredicateProbe(), source, { filename: "media-panel.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["true", "false"]);
  });
});
