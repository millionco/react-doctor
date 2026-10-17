import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

const commonOptions: RunRuleOptions = {
  filename: "src/example.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: { "react-doctor": { capabilities: ["react"] } },
};

const cases = [
  {
    name: "direct-host-legacy-request-then-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "one-local-prop-edge-direct-post-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "direct-host-awaited-inline-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "local-prop-plus-awaited-inline-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "earlier-independent-post-before-fulfillment-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/prepare"); await api.post("/items").then(() => { setReady(true); }); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "renamed-local-prop-binding",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend: submit }) => <form onSubmit={submit}/>;\n',
    count: 1,
  },
  {
    name: "local-function-declaration-child",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nfunction Forward({ onSend }) { return <form onSubmit={onSend}/>; }\n',
    count: 1,
  },
  {
    name: "local-prop-leading-busy-guard",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({busy}) => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); if (busy) return; await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "local-prop-leading-flag-and-disabled",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const [saving, setSaving] = useState(false); const send = async (event) => { event.preventDefault(); setSaving(true); await api.post("/items"); setReady(true); }; return <Forward onSend={send} saving={saving}/>; };\nexport default Example;\nconst Forward = ({ onSend, saving }) => <form onSubmit={onSend}><button disabled={saving}>Save</button></form>;\n',
    count: 0,
  },
  {
    name: "child-overrides-forwarded-handler",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={() => {}}/>;\n',
    count: 0,
  },
  {
    name: "caller-spread-may-replace-selected-prop",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({other}) => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send} {...other}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "native-spread-may-replace-handler",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend, other }) => <form onSubmit={onSend} {...other}/>;\n',
    count: 0,
  },
  {
    name: "selected-child-parameter-reassigned",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { onSend = () => {}; return <form onSubmit={onSend}/>; };\n',
    count: 0,
  },
  {
    name: "shadowed-selected-prop-in-nested-owner",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { const Inner = ({ onSend }) => <form onSubmit={onSend}/>; return <Inner onSend={() => {}}/>; };\n',
    count: 0,
  },
  {
    name: "imported-custom-component-is-opaque",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async () => { await api.post("/items"); setReady(true); }; return <Imported onSend={send}/>; };\nexport default Example;\nimport Imported from "example-ui";\n',
    count: 0,
  },
  {
    name: "unused-local-child-is-not-rendered",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async () => { await api.post("/items"); setReady(true); }; return <section/>; };\nexport default Example;\nconst Forward = ({onSend}) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "discarded-jsx-in-child-does-not-register",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { const unused = <form onSubmit={onSend}/>; return null; };\n',
    count: 0,
  },
  {
    name: "named-fulfillment-callback-stays-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const done = () => setReady(true); const send = async (event) => { event.preventDefault(); await api.post("/items").then(done); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "timer-callback-after-request-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setTimeout(() => setReady(true), 1); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "uninvoked-created-callback-after-request",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); const unused = () => setReady(true); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "setter-looking-local-call-is-not-react-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const setReady = (value) => value; const send = async () => { await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "rejection-handler-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").catch(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "fulfillment-with-leading-pending-guard",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({pending}) => { const [ready, setReady] = useState(false); const send = async () => { if (pending) return; await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "get-read-fulfillment-stays-quiet",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.get("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "local-store-method-is-not-network-request",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await store.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "onchange-event-is-outside-existing-policy",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <input onChange={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "concise-inline-fulfillment-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => setReady(true)); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "ordinary-function-inline-fulfillment-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(function (response) { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "duplicate-caller-selected-prop",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send} onSend={() => {}}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "written-selected-setter-is-not-native-proof",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); [setReady] = [() => {}]; await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "unreachable-fulfillment-state-after-return",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { return; setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "conditional-dead-fulfillment-state",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { if (false) setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "typeonly-native-hook-does-not-prove-state",
    code: 'import type { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "forwarding-arrow-is-not-direct-prop-value",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={() => onSend()}/>;\n',
    count: 0,
  },
  {
    name: "named-hook-alias-is-canonical",
    code: 'import { useState as useNativeState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useNativeState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "readonly-react-namespace-hook-is-canonical",
    code: 'import * as React from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = React.useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "native-use-reducer-dispatcher",
    code: 'import { useReducer } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useReducer((state, action) => action, false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "native-button-attribute-route",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <button onClick={onSend}/>;\n',
    count: 1,
  },
  {
    name: "native-wrapper-and-fragment-return-route",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <main><><Forward onSend={send}/></></main>; };\nexport default Example;\nconst Forward = ({ onSend }) => <div><form onSubmit={onSend}/></div>;\n',
    count: 1,
  },
  {
    name: "two-same-handler-call-sites-agree",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <><Forward onSend={send}/><Forward onSend={send}/></>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "readonly-function-declaration-handler",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  async function send(event) { event.preventDefault(); await api.post("/items"); setReady(true); } return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "local-function-expression-child",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = function ({ onSend }) { return <form onSubmit={onSend}/>; };\n',
    count: 1,
  },
  {
    name: "different-callers-abstain",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; const other = async () => {}; return <><Forward onSend={send}/><Forward onSend={other}/></>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "component-export-is-an-escape",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nexport { Forward };\n',
    count: 0,
  },
  {
    name: "component-alias-is-an-escape",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nconst Other = Forward;\n',
    count: 0,
  },
  {
    name: "component-ordinary-call-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nForward({ onSend: () => {} });\n',
    count: 0,
  },
  {
    name: "component-runtime-self-reference-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nfunction Forward({ onSend }) { inspect(Forward); return <form onSubmit={onSend}/>; }\n',
    count: 0,
  },
  {
    name: "handler-runtime-self-reference-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  async function send(event) { inspect(send); event.preventDefault(); await api.post("/items"); setReady(true); } return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "handler-value-escape-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; inspect(send); return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "handler-const-alias-transport-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; const forwarded = send; return <Forward onSend={forwarded}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "handler-object-pattern-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; [send] = otherHandlers; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "handler-loop-target-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; for (send of otherHandlers) {} return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "prop-object-pattern-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { ({ onSend } = otherProps); return <form onSubmit={onSend}/>; };\n',
    count: 0,
  },
  {
    name: "prop-loop-target-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { for (onSend of otherHandlers) {} return <form onSubmit={onSend}/>; };\n',
    count: 0,
  },
  {
    name: "prop-call-is-an-escape",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { inspect(onSend); return <form onSubmit={onSend}/>; };\n',
    count: 0,
  },
  {
    name: "prop-alias-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { const forwarded = onSend; return <form onSubmit={forwarded}/>; };\n',
    count: 0,
  },
  {
    name: "defaulted-prop-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend = () => {} }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "rest-props-are-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend, ...rest }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "computed-prop-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ ["onSend"]: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "async-child-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = async ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "generator-child-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nfunction* Forward({ onSend }) { return <form onSubmit={onSend}/>; };\n',
    count: 0,
  },
  {
    name: "child-returns-discarded-native-jsx",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { const form = <form onSubmit={onSend}/>; return null; };\n',
    count: 0,
  },
  {
    name: "child-returns-native-jsx-as-an-attribute",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <Retain initialContent={<form onSubmit={onSend}/>}/>;\n',
    count: 0,
  },
  {
    name: "child-unknown-render-wrapper-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <Retain><form onSubmit={onSend}/></Retain>;\n',
    count: 0,
  },
  {
    name: "child-native-call-after-return-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { return null; return <form onSubmit={onSend}/>; };\n',
    count: 0,
  },
  {
    name: "caller-unknown-render-wrapper-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Retain><Forward onSend={send}/></Retain>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "caller-returns-component-as-an-attribute",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Retain initialContent={<Forward onSend={send}/>}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "caller-statically-dead-return-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; if (false) return <Forward onSend={send}/>; return null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "callee-property-spread-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend} {...other}/>;\n',
    count: 0,
  },
  {
    name: "duplicate-native-event-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend} onSubmit={() => {}}/>;\n',
    count: 0,
  },
  {
    name: "state-setter-array-pattern-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  [setReady] = replacements; const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "state-setter-loop-target-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  for (setReady of replacements) {} const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "state-provider-object-pattern-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\n({ useState } = replacements); const Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "state-provider-loop-target-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nfor (useState of replacements) {} const Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "foreign-state-hook-abstains",
    code: 'import { useState } from "custom-state";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "unbound-state-hook-abstains",
    code: 'import api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "shadowed-state-hook-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = (useState) => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "namespace-provider-escape-abstains",
    code: 'import * as React from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = React.useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\ninspect(React);\n',
    count: 0,
  },
  {
    name: "state-hook-alias-escape-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nconst stateHook = useState;\n',
    count: 0,
  },
  {
    name: "runtime-ts-enum-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nenum Phase { Ready }\n',
    count: 0,
  },
  {
    name: "erased-local-number-annotation-preserves-event-transport",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst extra: number = 0; const Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "type-only-native-provider-abstains",
    code: 'import type { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "unused-type-only-alias-still-cannot-authorize-runtime-provider",
    code: 'import { type useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "generator-handler-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  async function* send(event) { event.preventDefault(); await api.post("/items"); setReady(true); } return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "same-spelling-different-parameter-is-not-forwarding",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <button onClick={(onSend) => onSend()}/>;\n',
    count: 0,
  },
  {
    name: "ordinary-function-child-with-multiple-parameters-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }, other) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "nested-function-render-route-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <main>{(() => <Forward onSend={send}/>)()}</main>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "closed-conditional-return-route",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return ready ? <Forward onSend={send}/> : null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "additional-type-only-named-react-import-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nimport type { useEffect as TypedEffect } from "react";\nconst importedCarrier = TypedEffect;\n',
    count: 0,
  },
  {
    name: "additional-type-only-default-react-import-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nimport type TypedReact from "react";\nconst importedCarrier = TypedReact;\n',
    count: 0,
  },
  {
    name: "additional-type-only-namespace-react-import-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nimport type * as TypedReact from "react";\nconst importedCarrier = TypedReact;\n',
    count: 0,
  },
  {
    name: "mixed-type-import-specifier-abstains",
    code: 'import { useState, type useEffect as TypedEffect } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nconst importedCarrier = TypedEffect;\n',
    count: 0,
  },
  {
    name: "unused-type-only-import-conservatively-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\nimport type { ReactNode } from "react";\n',
    count: 0,
  },
  {
    name: "special-key-prop-is-not-an-event-transport",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward key={send}/>; };\nexport default Example;\nconst Forward = ({ key: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "special-ref-prop-is-not-an-event-transport",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward ref={send}/>; };\nexport default Example;\nconst Forward = ({ ref: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "reserved-debug-self-prop-is-not-an-event-transport",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward __self={send}/>; };\nexport default Example;\nconst Forward = ({ __self: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "reserved-debug-source-prop-is-not-an-event-transport",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward __source={send}/>; };\nexport default Example;\nconst Forward = ({ __source: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "special-children-prop-is-not-an-event-transport",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward children={send}/>; };\nexport default Example;\nconst Forward = ({ children: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "nested-children-overrides-children-attribute",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward children={send}>Fixed content</Forward>; };\nexport default Example;\nconst Forward = ({ children: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "ordinary-renamed-callback-role-still-admitted",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onAction={send}/>; };\nexport default Example;\nconst Forward = ({ onAction: onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "numeric-nullish-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return 0 ?? <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "numeric-zero-conditional-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return 0 ? <Forward onSend={send}/> : null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "numeric-zero-logical-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return 0 && <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "truthy-numeric-or-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return 1 || <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "string-conditional-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return "" ? <Forward onSend={send}/> : null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "null-conditional-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return null ? <Forward onSend={send}/> : null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "literal-only-comparison-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return 0 === 1 ? <Forward onSend={send}/> : null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "loose-equality-route-is-unsupported",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return ready == true ? <Forward onSend={send}/> : null; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 0,
  },
  {
    name: "native-state-strict-equality-child-route",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { const [selected, setSelected] = useState(1); return selected === 1 ? <form onSubmit={onSend}/> : null; };\n',
    count: 1,
  },
  {
    name: "reversed-strict-inequality-logical-child-route",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items"); setReady(true); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => { const [selected, setSelected] = useState(1); return null !== selected && <form onSubmit={onSend}/>; };\n',
    count: 1,
  },
];

describe("local host event prop transport", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, testCase.code, commonOptions);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});
