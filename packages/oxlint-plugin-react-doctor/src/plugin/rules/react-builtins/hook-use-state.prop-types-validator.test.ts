import { getManifestCacheGeneration } from "../../utils/read-nearest-package-manifest.js";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import { isPropTypesObjectValidatorReference } from "../../utils/is-prop-types-object-validator-reference.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { hasRefNotificationReactCall } from "../state-and-effects/utils/has-ref-notification-react-call.js";
import { isUnmodifiedLocalReactStateCall } from "../../utils/is-unmodified-local-react-state-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { hookUseState } from "./hook-use-state.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prop-types-role-"));
const filename = path.join(temporaryDirectory, "Panel.tsx");
afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
beforeEach(() => resetFilesystemCaches());

const cases = [
  {
    name: "transparent-object-type-query",
    code: "import {useState} from 'react';import PropTypes from 'prop-types';export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf((Object as typeof Object)).isRequired};",
    expectedCount: 0,
  },
  {
    name: "direct-required-metadata",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 0,
  },
  {
    name: "plain-validator-metadata",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object)};',
    expectedCount: 0,
  },
  {
    name: "renamed-default-import",
    code: 'import {useState} from "react";import Validators from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:Validators.arrayOf(Object).isRequired};',
    expectedCount: 0,
  },
  {
    name: "transparent-object-argument",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf((Object as unknown)).isRequired};',
    expectedCount: 0,
  },
  {
    name: "component-transport-after-metadata",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};export default wrap(Panel);',
    expectedCount: 0,
  },
  {
    name: "distinct-component-metadata",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};const Other=()=> <div/>;Other.propTypes={items:PropTypes.arrayOf(Object)};',
    expectedCount: 0,
  },
  {
    name: "mismatched-setter",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value,updateValue]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "value-binding-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);value=1;return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "opaque-validator-consumer",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:opaqueValidator(Object)};',
    expectedCount: 1,
  },
  {
    name: "stored-validator-result",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};const validator=PropTypes.arrayOf(Object);Panel.propTypes={items:validator};',
    expectedCount: 1,
  },
  {
    name: "aliased-object-token",
    code: 'import {useState} from "react";import PropTypes from "prop-types";const NativeObject=Object;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(NativeObject).isRequired};',
    expectedCount: 1,
  },
  {
    name: "aliased-sdk-provider",
    code: 'import {useState} from "react";import PropTypes from "prop-types";const Validators=PropTypes;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:Validators.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "extracted-sdk-method",
    code: 'import {useState} from "react";import PropTypes from "prop-types";const arrayOf=PropTypes.arrayOf;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "sdk-method-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";PropTypes.arrayOf=replace;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "sdk-import-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";PropTypes=replace;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "second-sdk-import-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";import Other from "prop-types";Other.arrayOf=replace;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "second-sdk-namespace-escape",
    code: 'import {useState} from "react";import PropTypes from "prop-types";import * as Other from "prop-types";expose(Other);export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "sdk-destructuring-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";({provider:PropTypes}=replacement);export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "object-binding-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";Object=replacement;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "object-member-write",
    code: 'import {useState} from "react";import PropTypes from "prop-types";Object.arrayOf=replacement;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "global-object-replacement",
    code: 'import {useState} from "react";import PropTypes from "prop-types";globalThis.Object=replacement;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "global-object-alias-replacement",
    code: 'import {useState} from "react";import PropTypes from "prop-types";const root=globalThis;root.Object=replacement;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "shadow-object-parameter",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};const configure=(Object)=>{Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};};',
    expectedCount: 0,
  },
  {
    name: "shadow-object-declaration",
    code: 'import {useState} from "react";import PropTypes from "prop-types";const Object=customValidator;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 0,
  },
  {
    name: "type-only-object-shadow",
    code: 'import {useState} from "react";import PropTypes from "prop-types";type Object=unknown;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "computed-sdk-method",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes["arrayOf"](Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "optional-sdk-call",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf?.(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "spread-validator-argument",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(...[Object]).isRequired};',
    expectedCount: 1,
  },
  {
    name: "extra-validator-argument",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object,extra).isRequired};',
    expectedCount: 1,
  },
  {
    name: "called-validator-result",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired()};',
    expectedCount: 1,
  },
  {
    name: "constructed-validator-result",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:new (PropTypes.arrayOf(Object))()};',
    expectedCount: 1,
  },
  {
    name: "tagged-validator-result",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired``};',
    expectedCount: 1,
  },
  {
    name: "computed-required",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object)["isRequired"]};',
    expectedCount: 1,
  },
  {
    name: "double-required",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired.isRequired};',
    expectedCount: 1,
  },
  {
    name: "spread-metadata-record",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={...other,items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "getter-metadata-record",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={get items(){return PropTypes.arrayOf(Object).isRequired}};',
    expectedCount: 1,
  },
  {
    name: "computed-metadata-field",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={[key]:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "computed-component-metadata",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel["propTypes"]={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "component-not-proven",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return value};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "component-escape-before-metadata",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};expose(Panel);Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expectedCount: 1,
  },
  {
    name: "metadata-assignment-in-callback",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};const configure=()=>{Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};};',
    expectedCount: 1,
  },
  {
    name: "constructor-capability",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};const capability=(()=>{}).constructor;',
    expectedCount: 1,
  },
  {
    name: "dynamic-loader",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};import("external");',
    expectedCount: 1,
  },
  {
    name: "native-loader",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};const loader=require("node:module");',
    expectedCount: 1,
  },
  {
    name: "process-loader",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};process.getBuiltinModule("module");',
    expectedCount: 1,
  },
  {
    name: "direct-eval",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};eval("replace()");',
    expectedCount: 1,
  },
  {
    name: "unknown-computed-capability",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};const capability=provider[key];',
    expectedCount: 1,
  },
  {
    name: "runtime-react-namespace-escape",
    code: 'import React,{useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};expose(React);',
    expectedCount: 1,
  },
  {
    name: "sdk-reexport-escape",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};export {default as Validators} from "prop-types";',
    expectedCount: 1,
  },
];

describe("hook-use-state prop-types validator metadata", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(hookUseState, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});

const certificateCases = [
  {
    name: "shadow-object-parameter",
    code: "import {useState} from 'react';import PropTypes from 'prop-types';export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};const configure=(Object)=>{Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};};",
    expected: false,
  },
  {
    name: "shadow-object-declaration",
    code: "import {useState} from 'react';import PropTypes from 'prop-types';const Object=customValidator;export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};",
    expected: false,
  },
  {
    name: "named-default-spelling-is-not-default-syntax",
    code: 'import {useState} from "react";import {default as PropTypes} from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expected: false,
  },
  {
    name: "namespace-provider",
    code: 'import {useState} from "react";import * as PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expected: false,
  },
  {
    name: "type-only-provider",
    code: 'import {useState} from "react";import type PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expected: false,
  },
  {
    name: "relative-provider",
    code: 'import {useState} from "react";import PropTypes from "./prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expected: false,
  },
  {
    name: "local-provider",
    code: 'import {useState} from "react";const PropTypes={arrayOf:(value)=>value};export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expected: false,
  },
  {
    name: "canonical-provider",
    code: 'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
    expected: true,
  },
];

describe("prop-types Object-role certificate boundaries", () => {
  it.each(certificateCases)("$name", ({ code, expected }) => {
    const certificates: boolean[] = [];
    const probe: Rule = {
      ...hookUseState,
      create: (context) => ({
        Identifier: (node: EsTreeNode) => {
          if (
            node.type === "Identifier" &&
            "name" in node &&
            node.name === "Object" &&
            context.scopes.referenceFor(node)
          )
            certificates.push(isPropTypesObjectValidatorReference(node, context));
        },
      }),
    };
    const result = runRule(probe, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(certificates).toEqual([expected]);
  });
});

describe("prop-types provider proof and resolution epochs", () => {
  it("keeps default React-provider certificate modes unchanged on the same scope", () => {
    const modes: boolean[] = [];
    const probe: Rule = {
      ...hookUseState,
      create: (context) => ({
        CallExpression: (node: EsTreeNode) => {
          if (
            !isNodeOfType(node, "CallExpression") ||
            !isNodeOfType(node.callee, "Identifier") ||
            node.callee.name !== "useState"
          )
            return;
          const propTypesObjectValidator = (candidate: EsTreeNode): boolean =>
            isPropTypesObjectValidatorReference(candidate, context);
          modes.push(hasRefNotificationReactCall(node, "useState", context));
          modes.push(
            hasRefNotificationReactCall(node, "useState", context, { propTypesObjectValidator }),
          );
          modes.push(hasRefNotificationReactCall(node, "useState", context));
          modes.push(isUnmodifiedLocalReactStateCall(node, context.scopes));
          modes.push(
            isUnmodifiedLocalReactStateCall(node, context.scopes, { propTypesObjectValidator }),
          );
          modes.push(isUnmodifiedLocalReactStateCall(node, context.scopes));
        },
      }),
    };
    const result = runRule(
      probe,
      'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(modes).toEqual([false, true, false, false, true, false]);
  });

  it("rechecks SDK-mode resolution on the same semantic context after an epoch reset", () => {
    const directory = fs.mkdtempSync(path.join(temporaryDirectory, "scope-epoch-"));
    const sourceFilename = path.join(directory, "Panel.tsx");
    const configPath = path.join(directory, "tsconfig.json");
    const providerPath = path.join(directory, "provider.ts");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compilerOptions: { paths: { "prop-types": ["./provider"] } } }),
    );
    let certify: (() => boolean) | undefined;
    const probe: Rule = {
      ...hookUseState,
      create: (context) => ({
        CallExpression: (node: EsTreeNode) => {
          if (
            !isNodeOfType(node, "CallExpression") ||
            !isNodeOfType(node.callee, "Identifier") ||
            node.callee.name !== "useState"
          )
            return;
          const propTypesObjectValidator = (candidate: EsTreeNode): boolean =>
            isPropTypesObjectValidatorReference(candidate, context);
          certify = () =>
            hasRefNotificationReactCall(node, "useState", context, {
              propTypesObjectValidator,
              propTypesObjectValidatorGeneration: getManifestCacheGeneration(),
            });
        },
      }),
    };
    const result = runRule(
      probe,
      'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
      { filename: sourceFilename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(certify?.()).toBe(true);
    fs.writeFileSync(providerPath, "export default {};\n");
    resetFilesystemCaches();
    expect(certify?.()).toBe(false);
    fs.rmSync(providerPath);
    resetFilesystemCaches();
    expect(certify?.()).toBe(true);
  });

  it("records positive and negative module-remap dependencies through the whole predicate", () => {
    const directory = fs.mkdtempSync(path.join(temporaryDirectory, "collector-"));
    const sourceFilename = path.join(directory, "Panel.tsx");
    const configPath = path.join(directory, "tsconfig.json");
    const providerPath = path.join(directory, "provider.ts");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compilerOptions: { paths: { "prop-types": ["./provider"] } } }),
    );
    const collect = () =>
      collectCrossFileDependencyProbes({
        absoluteFilePath: sourceFilename,
        sourceText:
          'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
        ruleIds: ["hook-use-state"],
      });
    const absent = collect();
    expect(absent).not.toBeNull();
    expect(absent?.contentPaths.has(configPath)).toBe(true);
    expect(absent?.existencePaths.has(providerPath)).toBe(true);
    fs.writeFileSync(providerPath, "export default {};\n");
    resetFilesystemCaches();
    const present = collect();
    expect(present).not.toBeNull();
    expect(present?.contentPaths.has(configPath)).toBe(true);
    expect(present?.existencePaths.has(providerPath)).toBe(true);
    const result = runRule(
      hookUseState,
      'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object).isRequired};',
      { filename: sourceFilename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("prop-types metadata proof work", () => {
  it("shares provider validation across Object tokens in the same analysis", () => {
    const measureSymbolLookups = (componentCount: number, includeStateCalls = false): number => {
      let symbolLookups = 0;
      const probe: Rule = {
        ...hookUseState,
        create: (context) => {
          const originalScopes = context.scopes;
          const scopes = {
            ...originalScopes,
            symbolFor: (node: EsTreeNode) => {
              symbolLookups += 1;
              return originalScopes.symbolFor(node);
            },
          };
          const validatedContext = { ...context, scopes };
          if (includeStateCalls) return hookUseState.create(validatedContext);
          return {
            Identifier: (node: EsTreeNode) => {
              if (!isNodeOfType(node, "Identifier") || node.name !== "Object") return;
              expect(isPropTypesObjectValidatorReference(node, validatedContext)).toBe(true);
            },
          };
        },
      };
      const components = Array.from(
        { length: componentCount },
        (_, componentIndex) =>
          `const Panel${componentIndex}=()=>{${includeStateCalls ? "const[value]=useState(0);return <span>{value}</span>" : "return <span/>"}};Panel${componentIndex}.propTypes={items:PropTypes.arrayOf(Object)};`,
      ).join("");
      const result = runRule(
        probe,
        `import {useState} from 'react';import PropTypes from 'prop-types';${components}`,
        {
          filename,
        },
      );
      expect(result.parseErrors).toEqual([]);
      return symbolLookups;
    };
    const smallLookups = measureSymbolLookups(8);
    const largeLookups = measureSymbolLookups(32);
    expect(smallLookups).toBeGreaterThan(0);
    expect(largeLookups).toBeLessThanOrEqual(smallLookups * 6);
    const smallRuleLookups = measureSymbolLookups(8, true);
    const largeRuleLookups = measureSymbolLookups(32, true);
    expect(smallRuleLookups).toBeGreaterThan(0);
    expect(largeRuleLookups).toBeLessThanOrEqual(smallRuleLookups * 6);
  });
});

describe("prop-types provider cache mode identities", () => {
  it("keeps callback identities, live callbacks and generation-bound results distinct", () => {
    const certificates: boolean[] = [];
    const probe: Rule = {
      ...hookUseState,
      create: (context) => ({
        CallExpression: (node: EsTreeNode) => {
          if (
            !isNodeOfType(node, "CallExpression") ||
            !isNodeOfType(node.callee, "Identifier") ||
            node.callee.name !== "useState"
          )
            return;
          let acceptsObject = true;
          const acceptingValidator = () => acceptsObject;
          const rejectingValidator = () => false;
          const classify = (
            validator: (candidate: EsTreeNode) => boolean,
            generation?: number,
          ): void => {
            const options = {
              propTypesObjectValidator: validator,
              propTypesObjectValidatorGeneration: generation,
            };
            certificates.push(hasRefNotificationReactCall(node, "useState", context, options));
            certificates.push(isUnmodifiedLocalReactStateCall(node, context.scopes, options));
          };
          classify(acceptingValidator, 1);
          classify(rejectingValidator, 1);
          acceptsObject = false;
          classify(acceptingValidator, 2);
          acceptsObject = true;
          classify(acceptingValidator, 3);
          classify(acceptingValidator);
          acceptsObject = false;
          classify(acceptingValidator);
          certificates.push(hasRefNotificationReactCall(node, "useState", context));
          certificates.push(isUnmodifiedLocalReactStateCall(node, context.scopes));
        },
      }),
    };
    const result = runRule(
      probe,
      'import {useState} from "react";import PropTypes from "prop-types";export const Panel=()=>{const[value]=useState(0);return <span>{value}</span>};Panel.propTypes={items:PropTypes.arrayOf(Object)};',
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(certificates).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });
});
