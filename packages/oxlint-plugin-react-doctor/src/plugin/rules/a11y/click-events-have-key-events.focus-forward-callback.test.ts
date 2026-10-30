import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "./click-events-have-key-events.js";
import { noStaticElementInteractions } from "./no-static-element-interactions.js";

const cases = [
  {
    name: "existing-inline-native",
    code: '\nexport const ReedField = (props) => { \n\nreturn <div onClick={() => document.getElementById("reed-search")?.focus()} />; };',
    expectedCount: 0,
  },
  {
    name: "existing-plain-native-pair",
    code: '\nexport const ReedField = (props) => { const handler = () => { const destination = document.querySelector("#reed-search"); destination?.focus(); };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "existing-plain-positive-return-guard",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (pointerEvent.target.closest(".reed-token")) return; const destination = document.querySelector("#reed-search"); destination?.focus(); };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-direct-native",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-block-native",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-named-alias",
    code: 'import { useCallback as cacheHandler } from "react";\nexport const ReedField = (props) => { const handler = cacheHandler(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-default-namespace",
    code: 'import React from "react";\nexport const ReedField = (props) => { const handler = React.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-namespace-import",
    code: 'import * as ReactRuntime from "react";\nexport const ReedField = (props) => { const handler = ReactRuntime.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-readonly-hook-alias",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const cacheHandler = useCallback; const handler = cacheHandler(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-readonly-result-alias",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const forwardFocus = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []); const handler = forwardFocus;\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-readonly-function-argument",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const moveFocus = () => { const destination = document.querySelector("#reed-search"); destination?.focus(); }; const handler = useCallback(moveFocus, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-conditional-nullish",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={props.enabled ? handler : undefined} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-positive-return-guard",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target.closest(".reed-token")) return; const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "guard-only-block-native",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "guard-only-direct-native",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) document.getElementById("reed-search")?.focus(); };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-plus-guard",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "wrapper-plus-guard-typed",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(((pointerEvent) => { if (!(pointerEvent.target as Element).closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }) as React.MouseEventHandler<HTMLDivElement>, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "action-submit",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => props.submit(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "action-after-focus",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); props.submit(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "action-inside-guard",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); props.submit(); } }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "action-else",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } else { props.submit(); } }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "action-state-write",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { document.getElementById("reed-search")?.focus(); props.setActive(true); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "activation-click",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.click(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "custom-focus-api",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => props.editor.focus(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "custom-select-api",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => props.store.select(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "unknown-getter-focus",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => props.resolveEditor()?.focus(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "fake-hook-local",
    code: 'const useCallback = (callback) => () => { props.save(); callback(); };\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "fake-hook-import",
    code: 'import { useCallback } from "reed-hooks";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "fake-hook-unbound",
    code: '\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "fake-react-unbound",
    code: '\nexport const ReedField = (props) => { const handler = React.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "shadowed-hook-parameter",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const nested = (useCallback) => useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []); const handler = nested(props.custom);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "mutable-hook-alias",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { let cacheHandler = useCallback; cacheHandler = props.custom; const handler = cacheHandler(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "mutated-react-provider",
    code: 'import React from "react"; React.useCallback = customCache;\nexport const ReedField = (props) => { const handler = React.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "escaped-react-provider",
    code: 'import React from "react"; configure(React);\nexport const ReedField = (props) => { const handler = React.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "mutable-result",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { let handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []); handler = props.submit;\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "mutable-function-argument",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { let moveFocus = () => { const destination = document.querySelector("#reed-search"); destination?.focus(); }; const handler = useCallback(moveFocus, []); moveFocus = props.submit;\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "escaped-result",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []); configure(handler);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "spread-hook-args",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(...props.arguments);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "dynamic-dependencies",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, props.dependencies);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-wrong-event-binding",
    code: '\nexport const ReedField = (props) => { const otherEvent = props.event; const handler = (pointerEvent) => { if (!otherEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-target-factory",
    code: '\nexport const ReedField = (props) => { const handler = () => { if (!props.getTarget().closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-selector-action",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(props.buildSelector())) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-custom-focus",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) props.editor.focus(); };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-shadowed-document",
    code: '\nexport const ReedField = (props) => { const document = props.document; const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-lookup-selector-action",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector(props.getSelector()); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-focus-argument-action",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(props.save()); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-loop",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { while (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-async",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(async (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-return-value",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); return props.save(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "conditional-blocker",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent) => pointerEvent.stopPropagation(), []);\n\nreturn <div onClick={props.enabled ? handler : undefined} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-default-first-parameter",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent = props.save()) => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-default-extra-parameter",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback((pointerEvent, unused = props.save()) => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-default-extra-parameter",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent, unused = props.save()) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-destructured-parameter",
    code: '\nexport const ReedField = (props) => { const handler = ({ target }) => { if (!target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-reassigned-parameter",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { pointerEvent = props.event; if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-focus-binding-mismatch",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); props.destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-computed-closest",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target[props.method](".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-computed-focus",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")[props.method](), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-focus-argument-action",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(props.save()), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-document-alias-shadow",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const document = props.document; const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-mutated-document-provider",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { document.querySelector = props.resolve; const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-escaped-document-provider",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { configure(document); const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-mutated-namespace-alias",
    code: 'import React from "react";\nexport const ReedField = (props) => { const runtime = React; runtime.useCallback = props.custom; const handler = React.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-escaped-hook-alias",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const cacheHandler = useCallback; configure(cacheHandler); const handler = cacheHandler(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-mutated-function-property",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const moveFocus = () => { const destination = document.querySelector("#reed-search"); destination?.focus(); }; moveFocus.call = props.submit; const handler = useCallback(moveFocus, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-dynamic-selector-coercion",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.querySelector(props.selector)?.focus(), []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-template-selector-coercion",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector(`#${props.key}`); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-event-prototype-mutation",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { pointerEvent.target.closest = props.submit; if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-computed-document-global",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = window[document].querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-computed-document-lookup",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document[querySelector]("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-computed-owned-focus",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination[focus](); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-provider-member-call",
    code: 'import React from "react"; React.configure();\nexport const ReedField = (props) => { const handler = React.useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-local-native-getter",
    code: '\nexport const ReedField = (props) => { const findDestination = () => document.querySelector("#reed-search"); const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) findDestination()?.focus(); };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-local-custom-getter",
    code: '\nexport const ReedField = (props) => { const findDestination = () => props.editor; const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) findDestination()?.focus(); };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "guard-captured-event-not-parameter",
    code: '\nexport const ReedField = (props) => { const pointerEvent = props.event; const handler = () => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapper-mutated-global-document",
    code: 'import { useCallback } from "react";\nexport const ReedField = (props) => { document = props.document; const handler = useCallback(() => { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\n\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-window-document",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => window.document.querySelector("#reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "native-global-this-document",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => { const destination = globalThis.document.getElementById("reed-search"); destination?.focus(); }, []);\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "native-namespace-with-fragment",
    code: 'import React from "react";\nexport const ReedField = (props) => { const handler = React.useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <React.Fragment><div onClick={handler} /></React.Fragment>; };',
    expectedCount: 0,
  },
  {
    name: "render-time-dependency-value",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), [props.label]);\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "render-time-dependency-call",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), [props.buildLabel()]);\nreturn <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "plain-generator-guard",
    code: '\nexport const ReedField = (props) => { const handler = function*(pointerEvent) { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-generator",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(function*() { const destination = document.querySelector("#reed-search"); destination?.focus(); }, []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-direct-default",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(({target} = props.save()) => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-rest-parameter",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback((...events) => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-type-only-import",
    code: 'import type {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-inline-type-import",
    code: 'import {type useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-compat-import",
    code: 'import {useCallback} from "preact/compat";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-computed-literal-hook",
    code: 'import React from "react";\nexport const ReedField = (props) => { const handler = React["useCallback"](() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-optional-hook",
    code: 'import React from "react";\nexport const ReedField = (props) => { const handler = React.useCallback?.(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-spread-dependencies",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), [...props.dependencies]);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-nested-hook",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(useCallback(() => document.getElementById("reed-search")?.focus(), []), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "wrapped-actionable-conditional",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={props.enabled ? handler : props.save} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-action-before-guard",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { props.save(); if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-action-after-guard",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } props.save(); };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-event-alias",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { const eventAlias = pointerEvent; if (!eventAlias.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-closest-computed-identifier",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target[closest](".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-closest-spread",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(...props.selectors)) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-document-prototype-write",
    code: 'Document.prototype.querySelector = customLookup;\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-element-prototype-write",
    code: 'Element.prototype.closest = customClosest;\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-reflected-document-write",
    code: 'Object.defineProperty(document,"querySelector", {value: customLookup});\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-global-alias-write",
    code: 'const browser = window; browser.document = customDocument;\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-late-provider-write",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []); document.getElementById = props.resolve;\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-window-document-write",
    code: 'window.document = customDocument;\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-runtime-enum-write",
    code: 'enum UnsafeProvider {Apply = (document.querySelector = customLookup)}\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-extra-declarator",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"), changed = props.save(); destination?.focus(); } };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-return-action",
    code: '\nexport const ReedField = (props) => { const handler = (pointerEvent) => { if (pointerEvent.target.closest(".reed-token")) return props.save(); const destination = document.querySelector("#reed-search"); destination?.focus(); };\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-aliased-callback-escape",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []); const copy = handler; configure(copy);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-let-alias-escape",
    code: 'import {useCallback} from "react";\nexport const ReedField = (props) => { const handler = useCallback(() => document.getElementById("reed-search")?.focus(), []); let copy = handler; configure(copy);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-namespace-method-mutation",
    code: 'import React from "react"; const copy = React; copy.configure();\nexport const ReedField = (props) => { const handler = React.useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-focus-provider-method-alias",
    code: 'import React from "react"; const copy = React.useCallback; configure(copy);\nexport const ReedField = (props) => { const handler = React.useCallback(() => document.getElementById("reed-search")?.focus(), []);\nreturn <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-focus-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { document.querySelector("#reed-search").focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-escape",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { configure(document.querySelector("#reed-search")); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-binding-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = document.querySelector("#reed-search"); selected.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-alias-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = document.querySelector("#reed-search"); const copied = selected; copied.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-prototype-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { Object.getPrototypeOf(document.querySelector("#reed-search")).focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-reflected-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { Object.defineProperty(document.querySelector("#reed-search"), "focus", { value: props.save }); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-computed-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = document.querySelector("#reed-search"); selected[props.method] = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-function-return",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selectInput = () => document.querySelector("#reed-search"); configure(selectInput()); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-focus-arguments",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = document.querySelector("#reed-search"); selected.focus(props.save()); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-focus-getter",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = document.querySelector("#reed-search"); selected.__defineGetter__("focus", () => props.save); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "lookup-result-readonly-focus",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = document.querySelector("#reed-search"); selected?.focus(); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "lookup-result-wrapped-readonly-focus",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const selected = (document.querySelector("#reed-search") as HTMLInputElement); selected?.focus(); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 0,
  },
  {
    name: "native-input-prototype-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { HTMLInputElement.prototype.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-div-prototype-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { HTMLDivElement.prototype.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-button-prototype-destructure",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const { prototype: elementPrototype } = HTMLButtonElement; elementPrototype.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-svg-prototype-replacement",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { SVGSVGElement.prototype.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-image-constructor-escape",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { configure(Image); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-option-constructor-escape",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { configure(Option); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-event-prototype-exposure",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { Event.prototype.target = props.target; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "native-pointer-event-prototype-exposure",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { PointerEvent.prototype.target = props.target; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "unknown-prototype-exposure",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { Object.getPrototypeOf(props.element).focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "unknown-prototype-reader-alias",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { const readPrototype = Object.getPrototypeOf; configure(readPrototype(props.element)); const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "unknown-prototype-static-computed",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { props.element["prototype"].focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "unknown-protected-member-write",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { props.element.focus = props.save; const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".reed-token")) { const destination = document.querySelector("#reed-search"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "duplicate-local-function-action-then-native",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { function moveFocus() { props.save(); } function moveFocus() { document.querySelector("#reed-search")?.focus(); } const handler = useCallback(moveFocus, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "duplicate-local-function-native-then-action",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { function moveFocus() { document.querySelector("#reed-search")?.focus(); } function moveFocus() { props.save(); } const handler = useCallback(moveFocus, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "duplicate-local-function-native-then-native",
    code: 'import { useCallback } from "react"; export const ReedField = () => { function moveFocus() { document.querySelector("#reed-search")?.focus(); } function moveFocus() { document.querySelector("#reed-search")?.focus(); } const handler = useCallback(moveFocus, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "variable-initializer-overrides-hoisted-native-function",
    code: 'import { useCallback } from "react"; export const ReedField = (props) => { var moveFocus = props.save; function moveFocus() { document.querySelector("#reed-search")?.focus(); } const handler = useCallback(moveFocus, []); return <div onClick={handler} />; };',
    expectedCount: 1,
  },
  {
    name: "unambiguous-local-function-native-callback",
    code: 'import { useCallback } from "react"; export const ReedField = () => { function moveFocus() { document.querySelector("#reed-search")?.focus(); } const handler = useCallback(moveFocus, []); return <div onClick={handler} />; };',
    expectedCount: 0,
  },
];

for (const rule of [clickEventsHaveKeyEvents, noStaticElementInteractions]) {
  describe(`${rule.id} native focus callbacks`, () => {
    it.each(cases)("$name", ({ code, expectedCount }) => {
      const result = runRule(rule, code, { filename: "reed-field.tsx" });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expectedCount);
    });

    it("declines a namespace with unsupported API calls", () => {
      const result = runRule(
        rule,
        `import React from "react";
        export const ReedFields = () => {
          const focus = React.useCallback(() => document.getElementById("reed-search")?.focus(), []);
          const save = React.useState(() => document.getElementById("reed-search")?.focus(), []);
          return <><div onClick={focus} /><div onClick={save} /></>;
        };`,
        { filename: "reed-field.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    });
  });
}

it("keeps other static-element actions beside a native focus click", () => {
  const result = runRule(
    noStaticElementInteractions,
    `import { useCallback } from "react";
    export const ReedField = (props) => {
      const focus = useCallback(() => document.getElementById("reed-search")?.focus(), []);
      return <div onClick={focus} onMouseDown={props.drag} />;
    };`,
    { filename: "reed-field.tsx" },
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
});
