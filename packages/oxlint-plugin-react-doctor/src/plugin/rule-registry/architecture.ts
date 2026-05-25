// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { noDefaultProps } from "./../rules/architecture/no-default-props.js";
import { noGenericHandlerNames } from "./../rules/architecture/no-generic-handler-names.js";
import { noGiantComponent } from "./../rules/architecture/no-giant-component.js";
import { noLegacyClassLifecycles } from "./../rules/architecture/no-legacy-class-lifecycles.js";
import { noLegacyContextApi } from "./../rules/architecture/no-legacy-context-api.js";
import { noManyBooleanProps } from "./../rules/architecture/no-many-boolean-props.js";
import { noNestedComponentDefinition } from "./../rules/architecture/no-nested-component-definition.js";
import { noReactDomDeprecatedApis } from "./../rules/architecture/no-react-dom-deprecated-apis.js";
import { noReact19DeprecatedApis } from "./../rules/architecture/no-react19-deprecated-apis.js";
import { noRenderInRender } from "./../rules/architecture/no-render-in-render.js";
import { noRenderPropChildren } from "./../rules/architecture/no-render-prop-children.js";
import { reactCompilerDestructureMethod } from "./../rules/architecture/react-compiler-destructure-method.js";

export const ArchitectureRuleEntries = [
  {
    key: "react-doctor/no-default-props",
    id: "no-default-props",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noDefaultProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-generic-handler-names",
    id: "no-generic-handler-names",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noGenericHandlerNames,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-giant-component",
    id: "no-giant-component",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noGiantComponent,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-legacy-class-lifecycles",
    id: "no-legacy-class-lifecycles",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noLegacyClassLifecycles,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-legacy-context-api",
    id: "no-legacy-context-api",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noLegacyContextApi,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-many-boolean-props",
    id: "no-many-boolean-props",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noManyBooleanProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-nested-component-definition",
    id: "no-nested-component-definition",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noNestedComponentDefinition,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-react-dom-deprecated-apis",
    id: "no-react-dom-deprecated-apis",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noReactDomDeprecatedApis,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-react19-deprecated-apis",
    id: "no-react19-deprecated-apis",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noReact19DeprecatedApis,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-render-in-render",
    id: "no-render-in-render",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRenderInRender,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-render-prop-children",
    id: "no-render-prop-children",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRenderPropChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/react-compiler-destructure-method",
    id: "react-compiler-destructure-method",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...reactCompilerDestructureMethod,
      framework: "global",
      category: "Architecture",
    },
  },
] as const;
