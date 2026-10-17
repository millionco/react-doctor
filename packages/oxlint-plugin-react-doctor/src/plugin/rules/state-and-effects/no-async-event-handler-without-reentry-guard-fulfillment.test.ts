import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

const commonOptions: RunRuleOptions = {
  filename: "src/example.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: {
    "react-doctor": {
      capabilities: ["react"],
    },
  },
};

const cases = [
  {
    name: "direct-awaited-first-fulfillment-setter",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "concise-first-fulfillment-setter",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => setReady(true)); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "ordinary-function-first-fulfillment-setter",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(function(response) { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "renamed-single-fulfillment-parameter",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then((result) => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "local-host-prop-and-fulfillment-edges",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "earlier-post-and-local-prop-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/prepare"); await api.post("/items").then(() => { setReady(true); }); }; return <Forward onSend={send}/>; };\nexport default Example;\nconst Forward = ({ onSend }) => <form onSubmit={onSend}/>;\n',
    count: 1,
  },
  {
    name: "outer-try-preserves-direct-fulfillment-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); try { await api.post("/items").then(() => { setReady(true); }); } catch (error) { console.log(error); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "unknown-condition-retains-possible-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({ enabled }) => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); if (enabled) { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "native-fetch-patch-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await fetch("/items", { method: "PATCH" }).then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "canonical-namespace-state-fulfillment",
    code: 'import * as React from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = React.useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "legacy-own-setter-remains-after-named-continuation",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const finish = () => {}; const send = async (event) => { event.preventDefault(); await api.post("/items").then(finish); setReady(true); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "named-continuation-is-not-followed",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const finish = () => setReady(true); const send = async (event) => { event.preventDefault(); await api.post("/items").then(finish); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "async-continuation-is-not-followed",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(async () => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "generator-continuation-is-not-followed",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(function* () { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "timer-continuation-is-not-flattened",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setTimeout(() => setReady(true), 0); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "uninvoked-continuation-local-is-not-followed",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { const finish = () => setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "return-before-setter-is-not-first-expression",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { return; setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "throw-before-setter-is-not-first-expression",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { throw Error("stop"); setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "conditional-first-statement-is-not-flattened",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({ enabled }) => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { if (enabled) setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "preceding-opaque-work-is-not-skipped",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const observe = () => {}; const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { observe(); setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "catch-callback-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").catch(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "finally-callback-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").finally(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "read-only-get-is-not-mutating",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.get("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "preview-post-preserves-nonmutation-exception",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/preview").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "local-storage-put-is-not-network",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const db = { put: async () => null }; const send = async (event) => { event.preventDefault(); await db.put("item").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "zero-argument-mutate-is-not-request",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const mutate = async () => null; const send = async (event) => { event.preventDefault(); await mutate().then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "default-fetch-get-is-not-mutating",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await fetch("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "optional-then-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items")?.then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "optional-request-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post?.("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "computed-then-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items")["then"](() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "computed-request-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api["post"]("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "promise-alias-is-not-resolved",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); const request = api.post("/items"); await request.then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "two-continuations-are-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }, () => {}); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "prior-catch-chain-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").catch(() => null).then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "outer-catch-chain-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }).catch(() => null); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "unawaited-then-is-not-collected",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "unrelated-resolved-promise-is-not-network",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await Promise.resolve(null).then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "optional-setter-is-outside-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady?.(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "foreign-state-provider-preserves-legacy-quiet",
    code: 'import { useState } from "other-state";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "type-only-state-provider-is-outside-new-profile",
    code: 'import type { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "runtime-enum-is-outside-new-profile",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); enum Mode { Ready } const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "additional-type-only-provider-syntax-abstains",
    code: 'import { useState } from "react"; import type * as OtherReact from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "destructuring-setter-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({ replacements }) => { const [ready, setReady] = useState(false); [setReady] = replacements; const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "loop-setter-write-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({ replacements }) => { const [ready, setReady] = useState(false); for (setReady of replacements) {} const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "namespace-provider-escape-abstains",
    code: 'import * as React from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = React.useState(false); consume(React); const send = async (event) => { event.preventDefault(); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "callback-parameter-shadow-is-not-owned-setter",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then((setReady) => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "default-callback-parameter-is-not-admitted",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then((result = null) => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "destructured-callback-parameter-is-not-admitted",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then(({ value }) => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "rest-callback-parameter-is-not-admitted",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then((...results) => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "multiple-callback-parameters-are-not-admitted",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); await api.post("/items").then((result, other) => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "leading-busy-return-preserves-guard",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = ({ busy }) => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); if (busy) return; await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "leading-state-write-preserves-guard",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const [saving, setSaving] = useState(false);  const send = async (event) => { event.preventDefault(); setSaving(true); await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "unconditional-return-makes-await-unreachable",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); return; await api.post("/items").then(() => { setReady(true); }); }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "literal-false-branch-is-not-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); if (false) { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "numeric-zero-branch-is-not-new-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false);  const send = async (event) => { event.preventDefault(); if (0) { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "dead-array-test-alternate-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if ([]) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "dead-object-test-alternate-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if ({}) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "dead-inline-function-alternate-is-not-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if (() => null) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "direct-const-true-condition-root-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); const enabled = true; if (enabled) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "direct-const-object-condition-root-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); const response = { enabled: true }; if (response.enabled) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "direct-const-alias-condition-root-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); const source = true; const enabled = source; if (enabled) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "function-declaration-condition-root-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); function enabled() {} if (enabled) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "class-declaration-condition-root-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); class Enabled {} if (Enabled) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "awaited-response-strict-condition-preserves-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); const response = await api.get("/status"); if (response.status === "ready") { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "literal-true-consequent-preserves-edge",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if (true) { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 1,
  },
  {
    name: "regex-truthy-alternate-is-not-new-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if (/ready/) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "global-root-truthy-alternate-is-not-new-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if (globalThis) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "bigint-truthy-alternate-is-not-new-fulfillment",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if (1n) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "namespace-import-condition-root-abstains",
    code: 'import * as client from "example-client";\nimport { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); if (client) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "let-literal-condition-root-abstains",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); let enabled = true; if (enabled) {} else { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "empty-for-of-is-outside-new-fulfillment-scope",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); for (const item of []) { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "unmatched-switch-is-outside-new-fulfillment-scope",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); switch (1) { case 2: await api.post("/items").then(() => { setReady(true); }); break; default: break; } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
  {
    name: "empty-try-catch-is-outside-new-fulfillment-scope",
    code: 'import { useState } from "react";\nimport api from "example-client";\nconst Example = () => { const [ready, setReady] = useState(false); const send = async (event) => { event.preventDefault(); try {} catch (error) { await api.post("/items").then(() => { setReady(true); }); } }; return <form onSubmit={send}/>; };\nexport default Example;\n',
    count: 0,
  },
];

describe("awaited request fulfillment state", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, testCase.code, commonOptions);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.count);
    });
  }
});
