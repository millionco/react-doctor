// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { buttonHasType } from "./../rules/react-builtins/button-has-type.js";
import { checkedRequiresOnchangeOrReadonly } from "./../rules/react-builtins/checked-requires-onchange-or-readonly.js";
import { displayName } from "./../rules/react-builtins/display-name.js";
import { exhaustiveDeps } from "./../rules/react-builtins/exhaustive-deps.js";
import { forbidComponentProps } from "./../rules/react-builtins/forbid-component-props.js";
import { forbidDomProps } from "./../rules/react-builtins/forbid-dom-props.js";
import { forbidElements } from "./../rules/react-builtins/forbid-elements.js";
import { forwardRefUsesRef } from "./../rules/react-builtins/forward-ref-uses-ref.js";
import { hookUseState } from "./../rules/react-builtins/hook-use-state.js";
import { iframeMissingSandbox } from "./../rules/react-builtins/iframe-missing-sandbox.js";
import { jsxBooleanValue } from "./../rules/react-builtins/jsx-boolean-value.js";
import { jsxCurlyBracePresence } from "./../rules/react-builtins/jsx-curly-brace-presence.js";
import { jsxFilenameExtension } from "./../rules/react-builtins/jsx-filename-extension.js";
import { jsxFragments } from "./../rules/react-builtins/jsx-fragments.js";
import { jsxHandlerNames } from "./../rules/react-builtins/jsx-handler-names.js";
import { jsxKey } from "./../rules/react-builtins/jsx-key.js";
import { jsxMaxDepth } from "./../rules/react-builtins/jsx-max-depth.js";
import { jsxNoCommentTextnodes } from "./../rules/react-builtins/jsx-no-comment-textnodes.js";
import { jsxNoConstructedContextValues } from "./../rules/react-builtins/jsx-no-constructed-context-values.js";
import { jsxNoDuplicateProps } from "./../rules/react-builtins/jsx-no-duplicate-props.js";
import { jsxNoJsxAsProp } from "./../rules/react-builtins/jsx-no-jsx-as-prop.js";
import { jsxNoNewArrayAsProp } from "./../rules/react-builtins/jsx-no-new-array-as-prop.js";
import { jsxNoNewFunctionAsProp } from "./../rules/react-builtins/jsx-no-new-function-as-prop.js";
import { jsxNoNewObjectAsProp } from "./../rules/react-builtins/jsx-no-new-object-as-prop.js";
import { jsxNoScriptUrl } from "./../rules/react-builtins/jsx-no-script-url.js";
import { jsxNoTargetBlank } from "./../rules/react-builtins/jsx-no-target-blank.js";
import { jsxNoUndef } from "./../rules/react-builtins/jsx-no-undef.js";
import { jsxNoUselessFragment } from "./../rules/react-builtins/jsx-no-useless-fragment.js";
import { jsxPascalCase } from "./../rules/react-builtins/jsx-pascal-case.js";
import { jsxPropsNoSpreadMulti } from "./../rules/react-builtins/jsx-props-no-spread-multi.js";
import { jsxPropsNoSpreading } from "./../rules/react-builtins/jsx-props-no-spreading.js";
import { noArrayIndexKey } from "./../rules/react-builtins/no-array-index-key.js";
import { noChildrenProp } from "./../rules/react-builtins/no-children-prop.js";
import { noCloneElement } from "./../rules/react-builtins/no-clone-element.js";
import { noDanger } from "./../rules/react-builtins/no-danger.js";
import { noDangerWithChildren } from "./../rules/react-builtins/no-danger-with-children.js";
import { noDidMountSetState } from "./../rules/react-builtins/no-did-mount-set-state.js";
import { noDidUpdateSetState } from "./../rules/react-builtins/no-did-update-set-state.js";
import { noDirectMutationState } from "./../rules/react-builtins/no-direct-mutation-state.js";
import { noFindDomNode } from "./../rules/react-builtins/no-find-dom-node.js";
import { noIsMounted } from "./../rules/react-builtins/no-is-mounted.js";
import { noMultiComp } from "./../rules/react-builtins/no-multi-comp.js";
import { noNamespace } from "./../rules/react-builtins/no-namespace.js";
import { noReactChildren } from "./../rules/react-builtins/no-react-children.js";
import { noRedundantShouldComponentUpdate } from "./../rules/react-builtins/no-redundant-should-component-update.js";
import { noRenderReturnValue } from "./../rules/react-builtins/no-render-return-value.js";
import { noSetState } from "./../rules/react-builtins/no-set-state.js";
import { noStringRefs } from "./../rules/react-builtins/no-string-refs.js";
import { noThisInSfc } from "./../rules/react-builtins/no-this-in-sfc.js";
import { noUnescapedEntities } from "./../rules/react-builtins/no-unescaped-entities.js";
import { noUnknownProperty } from "./../rules/react-builtins/no-unknown-property.js";
import { noUnsafe } from "./../rules/react-builtins/no-unsafe.js";
import { noUnstableNestedComponents } from "./../rules/react-builtins/no-unstable-nested-components.js";
import { noWillUpdateSetState } from "./../rules/react-builtins/no-will-update-set-state.js";
import { onlyExportComponents } from "./../rules/react-builtins/only-export-components.js";
import { preferEs6Class } from "./../rules/react-builtins/prefer-es6-class.js";
import { preferFunctionComponent } from "./../rules/react-builtins/prefer-function-component.js";
import { reactInJsxScope } from "./../rules/react-builtins/react-in-jsx-scope.js";
import { requireRenderReturn } from "./../rules/react-builtins/require-render-return.js";
import { rulesOfHooks } from "./../rules/react-builtins/rules-of-hooks.js";
import { selfClosingComp } from "./../rules/react-builtins/self-closing-comp.js";
import { stateInConstructor } from "./../rules/react-builtins/state-in-constructor.js";
import { stylePropObject } from "./../rules/react-builtins/style-prop-object.js";
import { voidDomElementsNoChildren } from "./../rules/react-builtins/void-dom-elements-no-children.js";

export const ReactBuiltinsRuleEntries = [
  {
    key: "react-doctor/button-has-type",
    id: "button-has-type",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...buttonHasType,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/checked-requires-onchange-or-readonly",
    id: "checked-requires-onchange-or-readonly",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...checkedRequiresOnchangeOrReadonly,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/display-name",
    id: "display-name",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...displayName,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/exhaustive-deps",
    id: "exhaustive-deps",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...exhaustiveDeps,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/forbid-component-props",
    id: "forbid-component-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forbidComponentProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/forbid-dom-props",
    id: "forbid-dom-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forbidDomProps,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/forbid-elements",
    id: "forbid-elements",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forbidElements,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/forward-ref-uses-ref",
    id: "forward-ref-uses-ref",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...forwardRefUsesRef,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/hook-use-state",
    id: "hook-use-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...hookUseState,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/iframe-missing-sandbox",
    id: "iframe-missing-sandbox",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Security",
    severity: "warn",
    rule: {
      ...iframeMissingSandbox,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/jsx-boolean-value",
    id: "jsx-boolean-value",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxBooleanValue,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-curly-brace-presence",
    id: "jsx-curly-brace-presence",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxCurlyBracePresence,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-filename-extension",
    id: "jsx-filename-extension",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxFilenameExtension,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-fragments",
    id: "jsx-fragments",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxFragments,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-handler-names",
    id: "jsx-handler-names",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxHandlerNames,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-key",
    id: "jsx-key",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...jsxKey,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-max-depth",
    id: "jsx-max-depth",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxMaxDepth,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-no-comment-textnodes",
    id: "jsx-no-comment-textnodes",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...jsxNoCommentTextnodes,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-no-constructed-context-values",
    id: "jsx-no-constructed-context-values",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoConstructedContextValues,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-duplicate-props",
    id: "jsx-no-duplicate-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...jsxNoDuplicateProps,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-no-jsx-as-prop",
    id: "jsx-no-jsx-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoJsxAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-new-array-as-prop",
    id: "jsx-no-new-array-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoNewArrayAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-new-function-as-prop",
    id: "jsx-no-new-function-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoNewFunctionAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-new-object-as-prop",
    id: "jsx-no-new-object-as-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsxNoNewObjectAsProp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/jsx-no-script-url",
    id: "jsx-no-script-url",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Security",
    severity: "error",
    rule: {
      ...jsxNoScriptUrl,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/jsx-no-target-blank",
    id: "jsx-no-target-blank",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Security",
    severity: "warn",
    rule: {
      ...jsxNoTargetBlank,
      framework: "global",
      category: "Security",
    },
  },
  {
    key: "react-doctor/jsx-no-undef",
    id: "jsx-no-undef",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...jsxNoUndef,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-no-useless-fragment",
    id: "jsx-no-useless-fragment",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxNoUselessFragment,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-pascal-case",
    id: "jsx-pascal-case",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxPascalCase,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/jsx-props-no-spread-multi",
    id: "jsx-props-no-spread-multi",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...jsxPropsNoSpreadMulti,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/jsx-props-no-spreading",
    id: "jsx-props-no-spreading",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...jsxPropsNoSpreading,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-array-index-key",
    id: "no-array-index-key",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noArrayIndexKey,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-children-prop",
    id: "no-children-prop",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noChildrenProp,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-clone-element",
    id: "no-clone-element",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noCloneElement,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-danger",
    id: "no-danger",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDanger,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-danger-with-children",
    id: "no-danger-with-children",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noDangerWithChildren,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-did-mount-set-state",
    id: "no-did-mount-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDidMountSetState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-did-update-set-state",
    id: "no-did-update-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noDidUpdateSetState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-direct-mutation-state",
    id: "no-direct-mutation-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...noDirectMutationState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-find-dom-node",
    id: "no-find-dom-node",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noFindDomNode,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-is-mounted",
    id: "no-is-mounted",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noIsMounted,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-multi-comp",
    id: "no-multi-comp",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noMultiComp,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-namespace",
    id: "no-namespace",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noNamespace,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-react-children",
    id: "no-react-children",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noReactChildren,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-redundant-should-component-update",
    id: "no-redundant-should-component-update",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noRedundantShouldComponentUpdate,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-render-return-value",
    id: "no-render-return-value",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noRenderReturnValue,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-set-state",
    id: "no-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...noSetState,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/no-string-refs",
    id: "no-string-refs",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noStringRefs,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-this-in-sfc",
    id: "no-this-in-sfc",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noThisInSfc,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unescaped-entities",
    id: "no-unescaped-entities",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUnescapedEntities,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unknown-property",
    id: "no-unknown-property",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUnknownProperty,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unsafe",
    id: "no-unsafe",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noUnsafe,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/no-unstable-nested-components",
    id: "no-unstable-nested-components",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...noUnstableNestedComponents,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/no-will-update-set-state",
    id: "no-will-update-set-state",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...noWillUpdateSetState,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/only-export-components",
    id: "only-export-components",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "error",
    rule: {
      ...onlyExportComponents,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/prefer-es6-class",
    id: "prefer-es6-class",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...preferEs6Class,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/prefer-function-component",
    id: "prefer-function-component",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...preferFunctionComponent,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/react-in-jsx-scope",
    id: "react-in-jsx-scope",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...reactInJsxScope,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/require-render-return",
    id: "require-render-return",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...requireRenderReturn,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/rules-of-hooks",
    id: "rules-of-hooks",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "error",
    rule: {
      ...rulesOfHooks,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/self-closing-comp",
    id: "self-closing-comp",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...selfClosingComp,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/state-in-constructor",
    id: "state-in-constructor",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Architecture",
    severity: "warn",
    rule: {
      ...stateInConstructor,
      framework: "global",
      category: "Architecture",
    },
  },
  {
    key: "react-doctor/style-prop-object",
    id: "style-prop-object",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...stylePropObject,
      framework: "global",
      category: "Correctness",
    },
  },
  {
    key: "react-doctor/void-dom-elements-no-children",
    id: "void-dom-elements-no-children",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Correctness",
    severity: "warn",
    rule: {
      ...voidDomElementsNoChildren,
      framework: "global",
      category: "Correctness",
    },
  },
] as const;
