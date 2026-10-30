import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { runRule } from "../../test-utils/run-rule.js";
import { clickEventsHaveKeyEvents } from "../rules/a11y/click-events-have-key-events.js";
import { noStaticElementInteractions } from "../rules/a11y/no-static-element-interactions.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFocusForwardingOrBlockingHandlerExpression } from "./is-focus-forwarding-handler.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

const cases = [
  {
    name: "baseline-native-direct",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { document.getElementById("amber-field")?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "baseline-closest",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".chip")) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-direct",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-reversed",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.currentTarget === pointerEvent.target) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-typed",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if ((pointerEvent as React.MouseEvent).target === (pointerEvent as React.MouseEvent).currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-single-statement",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) document.getElementById("amber-field")?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-const-target",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-||-getElementById-getElementById",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.getElementById("birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-||-getElementById-querySelector",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-||-querySelector-getElementById",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector("#amber-field") || document.getElementById("birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-||-querySelector-querySelector",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector("#amber-field") || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-fallback-||",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = (document.getElementById("amber-field") || document.querySelector("#birch-field")); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "closest-fallback-||",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".chip")) { const destination = (document.getElementById("amber-field") || document.querySelector("#birch-field")); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "closest-return-fallback-||",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target.closest(".chip")) return; const destination = (document.getElementById("amber-field") || document.querySelector("#birch-field")); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-??-getElementById-getElementById",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") ?? document.getElementById("birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-??-getElementById-querySelector",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") ?? document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-??-querySelector-getElementById",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector("#amber-field") ?? document.getElementById("birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "fallback-??-querySelector-querySelector",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector("#amber-field") ?? document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "self-click-fallback-??",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = (document.getElementById("amber-field") ?? document.querySelector("#birch-field")); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "closest-fallback-??",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (!pointerEvent.target.closest(".chip")) { const destination = (document.getElementById("amber-field") ?? document.querySelector("#birch-field")); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "closest-return-fallback-??",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target.closest(".chip")) return; const destination = (document.getElementById("amber-field") ?? document.querySelector("#birch-field")); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "hold-fallback-native-global-spellings",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = window.document.getElementById("amber-field") ?? globalThis.document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "fallback-required-focus",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination.focus(); }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
  {
    name: "hold-self-other-event",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (props.event.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-same-other-event",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (props.event.target === props.event.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-loose-equality",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target == pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-inequality",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target !== pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-computed",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent["target"] === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-optional",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent?.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-receiver-factory",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (props.getEvent().target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-sequence",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if ((props.save(), pointerEvent.target === pointerEvent.currentTarget)) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-self-compound",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget && props.enabled) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-else",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } else { props.save(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-action-before",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { props.save(); if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-action-after",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } props.save(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-action-inside",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); props.save(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-event-read",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); pointerEvent.type; } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-event-write",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { pointerEvent = props.event; if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-event-escape",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { props.observe(pointerEvent); if (pointerEvent.target === pointerEvent.currentTarget) { document.getElementById("amber-field")?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-return-action",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) return props.save(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-custom-focus",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) props.editor.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-self-click",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) document.getElementById("amber-field")?.click(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-custom-receiver-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = props.editor || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-custom-receiver-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || props.editor; destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-getter-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = props.destination || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-getter-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || props.destination; destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-helper-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = props.getDestination() || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-helper-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || props.getDestination(); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-null-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = null || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-null-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || null; destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-false-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = false || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-false-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || false; destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-undefined-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = undefined || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-undefined-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || undefined; destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-dynamic-selector-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector(props.selector) || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-dynamic-selector-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector(props.selector); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-selector-call-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector(props.buildSelector()) || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-selector-call-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector(props.buildSelector()); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-selector-coercion-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.querySelector({ toString() { props.save(); return "#birch-field"; } }) || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-selector-coercion-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector({ toString() { props.save(); return "#birch-field"; } }); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-sequence-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = (props.save(), document.querySelector("#birch-field")) || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-sequence-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || (props.save(), document.querySelector("#birch-field")); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-computed-lookup-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document["querySelector"]("#birch-field") || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-computed-lookup-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document["querySelector"]("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-document-getter-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = props.document.querySelector("#birch-field") || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-document-getter-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || props.document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-third-lookup-left",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = (document.querySelector("#birch-field") || document.getElementById("cedar-field")) || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-third-lookup-right",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || (document.querySelector("#birch-field") || document.getElementById("cedar-field")); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-nullish-false",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") ?? false; destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-and",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") && document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-direct-logical",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { (document.getElementById("amber-field") || document.querySelector("#birch-field"))?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-let",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { let destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-extra-declarator",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"), extra = props.save(); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-field-escape",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); props.observe(destination); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-field-alias",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); const copied = destination; }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-field-store",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); props.destination = destination; }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-field-read",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); destination.id; }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-field-write",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); destination.focus = props.save; }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-focus-argument",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(props.save()); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "hold-fallback-action",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); props.save(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-document-shadow",
    code: 'import { useCallback } from "react"; \nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { const document = props.document; const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-document-mutation",
    code: 'import { useCallback } from "react"; document.querySelector = customLookup;\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-document-escape",
    code: 'import { useCallback } from "react"; configure(document);\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-react-provider",
    code: 'import { useCallback } from "react"; useCallback.configure = customProvider;\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-prototype-exposure",
    code: 'import { useCallback } from "react"; configure(HTMLInputElement.prototype);\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-other-lookup-escape",
    code: 'import { useCallback } from "react"; configure(document.querySelector("#birch-field"));\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-other-fallback-escape",
    code: 'import { useCallback } from "react"; const selected = document.getElementById("amber-field") || document.querySelector("#birch-field"); configure(selected);\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-other-fallback-alias",
    code: 'import { useCallback } from "react"; const selected = document.getElementById("amber-field") ?? document.querySelector("#birch-field"); const copied = selected; configure(copied);\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-other-fallback-write",
    code: 'import { useCallback } from "react"; const selected = document.getElementById("amber-field") || document.querySelector("#birch-field"); selected.focus = customFocus;\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "positive-provider-other-fallback-computed-write",
    code: 'import { useCallback } from "react"; const selected = document.getElementById("amber-field") ?? document.querySelector("#birch-field"); selected[unknownMember] = customFocus;\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: false,
  },
  {
    name: "fallback-independent-readonly-use",
    code: 'import { useCallback } from "react"; const selected = document.getElementById("amber-field") ?? document.querySelector("#birch-field"); selected?.focus();\nexport const Field = (props) => { const handler = useCallback((pointerEvent) => { if (pointerEvent.target === pointerEvent.currentTarget) { const destination = document.getElementById("amber-field") || document.querySelector("#birch-field"); destination?.focus(); } }, []); return <div onClick={handler} />; };',
    accepted: true,
  },
];

describe("finite native focus follow-up", () => {
  it.each(cases)("$name", ({ code, accepted }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    let handlerExpression: EsTreeNode | undefined;
    walkAst(parsed.program, (node) => {
      if (isNodeOfType(node, "JSXAttribute") && isNodeOfType(node.value, "JSXExpressionContainer"))
        handlerExpression = node.value.expression;
    });
    if (!handlerExpression) throw new Error("Expected the synthetic native focus handler");
    expect(
      isFocusForwardingOrBlockingHandlerExpression(
        handlerExpression,
        analyzeScopes(parsed.program),
      ),
    ).toBe(accepted);
    for (const rule of [clickEventsHaveKeyEvents, noStaticElementInteractions]) {
      const result = runRule(rule, code, { filename: "focus-field.tsx" });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(accepted ? 0 : 1);
    }
  });
});
