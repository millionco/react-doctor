import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup bounded helper listener paths", () => {
  for (const testCase of [
    {
      name: "reports a listener for direct no return",
      source:
        "import { useEffect } from 'react';\nexport default function Panel() {\n  useEffect(() => {\n    document.addEventListener('pointermove', () => {});\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for direct empty returned cleanup",
      source:
        "import { useEffect } from 'react';\nexport default function Panel() {\n  useEffect(() => {\n    document.addEventListener('pointermove', () => {});\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for direct unrelated private scalar cleanup",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nexport default function Panel() {\n  useEffect(() => {\n    document.addEventListener('pointermove', () => {});\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for one hop no return",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nexport default function Panel() {\n  useEffect(() => {\n    install();\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for one hop empty returned cleanup",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nexport default function Panel() {\n  useEffect(() => {\n    install();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for one hop unrelated private scalar cleanup",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nexport default function Panel() {\n  useEffect(() => {\n    install();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for two hop no return",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for two hop empty returned cleanup",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for two hop unrelated private scalar cleanup",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "declines two hop once self release",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}, { once: true }); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop matching returned remove",
      source:
        "import { useEffect } from 'react';\nconst listener = () => {};\nconst install = () => { document.addEventListener('pointermove', listener); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { document.removeEventListener('pointermove', listener); };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop synchronous caller remove",
      source:
        "import { useEffect } from 'react';\nconst listener = () => {};\nconst install = () => { document.addEventListener('pointermove', listener); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    document.removeEventListener('pointermove', listener);\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop leaf synchronous remove",
      source:
        "import { useEffect } from 'react';\nconst listener = () => {};\nconst install = () => { document.addEventListener('pointermove', listener); document.removeEventListener('pointermove', listener); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines an unsupported named second-hop listener despite earlier removal",
      source:
        "import { useEffect } from 'react';\nconst listener = () => {};\nconst install = () => { document.addEventListener('pointermove', listener); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    document.removeEventListener('pointermove', listener);\n    prepare();\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "preserves the existing deferred timer warning without following its helper callback",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    setTimeout(() => { prepare(); }, 20);\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: "`setTimeout`",
    },
    {
      name: "declines two hop merely defined",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    const delayed = () => { prepare(); };\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop microtask deferred",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    Promise.resolve().then(() => { prepare(); });\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop literal false",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    if (false) { prepare(); }\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines three helper edges without a private flag",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nconst arrange = () => { prepare(); };\nexport default function Panel() {\n  useEffect(() => {\n    arrange();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop private flag read by handler",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => { if (active) document.title; }); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop opaque cleanup",
      source:
        "import { useEffect } from 'react';\nimport { dispose } from './teardown';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return dispose;\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop custom target shadow",
      source:
        "import { useEffect } from 'react';\nconst document = { addEventListener() {} };\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop null listener",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', null); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop provider reassigned",
      source:
        "import { useEffect } from 'react';\ndocument.addEventListener = () => {};\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop escaped helper",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const exportedPrepare = prepare;\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop optional caller",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare?.();\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop shadowed console cleanup",
      source:
        "import { useEffect } from 'react';\nconst console = { info() { document.removeEventListener('pointermove', listener); } };\nconst listener = () => {};\nconst install = () => { document.addEventListener('pointermove', listener); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info(); };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "reports a listener for two hop genuine console literal cleanup",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('finished'); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports one effect owner for direct and helper allocations",
      source:
        "import { useEffect } from 'react';\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    document.addEventListener('scroll', () => {});\n    return () => {};\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for closed private boolean",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for handler local shadow",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => { const active = false; return active; }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for unicode distinct shadow",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => { const аctive = false; return аctive; }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for object static property name",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section data-label={ { active: true }.active } />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "declines offchain exported read",
      source:
        "export const inspectState = () => active;\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines offchain shorthand snapshot",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst snapshot = { active };\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines offchain jsx read",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section>{active}</section>;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines listener captures private flag",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => { if (active) { document.title; } }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines nested listener function captures flag",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => { const read = () => active; read(); }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines handler publishes flag reader",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => { window.pending = () => active; }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup alias write",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { const next = false; active = next; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup compound write",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active &&= false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup property write",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { window.active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup assignment chain",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = window.active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup fake console namespace",
      source:
        "const console = { info: value => value };\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('complete'); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup log resource object",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info(document); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup log coercing object",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info({ toString() { active = false; return ''; } }); };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines cleanup log template coercion",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info(`${window.pending}`); };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "reports a listener for cleanup genuine literal logging",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('complete', false, 7, null); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "declines console direct method mutation",
      source:
        "console.info = () => {};\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('complete'); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines console alias reflect mutation",
      source:
        "const logger = console;\nReflect.set(logger, 'info', () => {});\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('complete'); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines console object assign mutation",
      source:
        "Object.assign(console, { info: () => {} });\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('complete'); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines document defineproperty mutation",
      source:
        "Object.defineProperty(document, 'addEventListener', { value: () => {} });\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines window namespace reflect mutation",
      source:
        "const target = window;\nReflect.set(target, 'addEventListener', () => {});\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { window.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines document namespace opaque escape",
      source:
        "configureTarget(document);\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines shadowed reflect capability",
      source:
        "const Reflect = { set(target, key, value) { target[key] = value; } };\nReflect.set(document, 'addEventListener', () => {});\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop once options unsupported",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}, { once: true }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines two hop signal options unsupported",
      source:
        "const controller = new AbortController();\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}, { signal: controller.signal }); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines three helper edges guarded by a private flag",
      source:
        "const arrange = () => { prepare(); };\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    arrange();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines helper external callsite",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section onClick={prepare} />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines a recursive helper chain",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); prepare(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines helper reassignment",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nlet prepare = () => { if (active) { install(); } };\nprepare = () => {};\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines a sibling helper with a potential listener release",
      source:
        "const handler = () => {};\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst release = () => { document.removeEventListener('pointermove', handler); };\nconst prepare = () => { if (active) { install(); } release(); };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines iife deferred flag read",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    (() => { Promise.resolve().then(() => { if (active) { document.title; } }); })();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines iife named closure flag read",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    (() => { const inspect = () => active; inspect(); })();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines console namespace escape to freeze",
      source:
        "Object.freeze(console);\nimport { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { console.info('complete'); active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines inline exported helper declaration",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nexport const prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines inline exported private flag",
      source:
        "import { useEffect } from 'react';\nexport let active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines globalthis document method replacement",
      source:
        "import { useEffect } from 'react';\nglobalThis.document.addEventListener = () => {};\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines zero actual default parameter helper",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = (configured = configure()) => { if (active) { install(); } };\nexport default function Panel() {\n  useEffect(() => {\n    prepare();\n    return () => { active = false; };\n  }, []);\n  return <section />;\n}\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines document constructor prototype",
      source:
        "import { useEffect } from 'react';\nconst NativeDocument = document.constructor; NativeDocument.prototype.addEventListener = () => {};\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines window constructor prototype",
      source:
        "import { useEffect } from 'react';\nconst NativeWindow = window.constructor; NativeWindow.prototype.addEventListener = () => {};\nconst install = () => { window.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines document defaultview window alias",
      source:
        "import { useEffect } from 'react';\nconst view = document.defaultView; view.addEventListener = () => {};\nconst install = () => { window.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines document prototype alias",
      source:
        "import { useEffect } from 'react';\nconst prototype = document.__proto__; prototype.addEventListener = () => {};\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines global eval provider replacement",
      source:
        "import { useEffect } from 'react';\neval(\"window.addEventListener = () => {};\");\nconst install = () => { window.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines global function provider replacement",
      source:
        "import { useEffect } from 'react';\nFunction(\"window.addEventListener = () => {};\")();\nconst install = () => { window.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines known local provider alias mutator",
      source:
        "import { useEffect } from 'react';\nconst overwrite = (receiver) => { receiver.addEventListener = () => {}; }; overwrite(document.defaultView);\nconst install = () => { window.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines deferred private flag writer is unsupported",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { if (active) install(); setTimeout(() => { active = false; }, 20); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => { active = false; }; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines self-recursion through a named function expression",
      source:
        "import { useEffect } from 'react';\nlet active = true;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = function again() { install(); again(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => { active = false; }; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines function literal derived constructor capability",
      source:
        "import { useEffect } from 'react';\nconst Evaluate = (() => {}).constructor;\nEvaluate(\"document.addEventListener = () => {};\")();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines constructor bracket literal",
      source:
        "import { useEffect } from 'react';\nconst Evaluate = (() => {})['constructor']; Evaluate('document.addEventListener=()=>{}')();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines constructor template literal",
      source:
        "import { useEffect } from 'react';\nconst Evaluate = (() => {})[`constructor`]; Evaluate('document.addEventListener=()=>{}')();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines constructor computed concat direct",
      source:
        "import { useEffect } from 'react';\n(() => {})['con' + 'structor']('document.addEventListener=()=>{}')();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines constructor computed const key alias call",
      source:
        "import { useEffect } from 'react';\nconst key = 'constructor'; const Evaluate = (() => {})[key]; Evaluate('document.addEventListener=()=>{}')();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines constructor computed callee call chain",
      source:
        "import { useEffect } from 'react';\n(() => {})['con' + 'structor'].call(null, 'document.addEventListener=()=>{}')();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines constructor computed alias handoff",
      source:
        "import { useEffect } from 'react';\nconst key = 'constructor'; const Evaluate = (() => {})[key]; const invoke = factory => factory('document.addEventListener=()=>{}')(); invoke(Evaluate);\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines object freeze visible replacement",
      source:
        "import { useEffect } from 'react';\nObject.freeze = () => {}; Object.freeze({});\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines object freeze method alias",
      source:
        "import { useEffect } from 'react';\nconst freeze = Object.freeze; freeze({});\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "reports a listener for object freeze ordinary unmodified",
      source:
        "import { useEffect } from 'react';\nObject.freeze({ value: 1 });\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for primitive array index data",
      source:
        "import { useEffect } from 'react';\nconst labels = ['first', 'second']; const label = labels[0]; const caption = `${label}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "declines primitive array computed callable alias unsupported",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const key = 'filter'; const invoke = values[key]; invoke();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines string index alias member callable escape",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const key = 'filter'; const invoke = values[key]; const box = {}; box.handler = invoke; box.handler();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "declines string index direct callable argument escape",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const key = 'filter'; const consume = value => value(); consume(values[key]);\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric literal direct data argument",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const consume = value => String(value); consume(values[0]);\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric literal alias member data write",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const caption = values[0]; const box = {}; box.caption = caption;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric remainder alias template data",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 1; const caption = values[cursor % 2]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "declines callable transport through a concatenated string index",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const key = 'fil' + 'ter'; const invoke = values[key]; const box = {}; box.handler = invoke; box.handler();\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 0,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric unary plus",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[+cursor]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric unary minus",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[-cursor]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener beside bitwise complement index data",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[~cursor]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary subtract",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor - 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary multiply",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor * 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary divide",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor / 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary remainder",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor % 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary power",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor ** 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary shift left",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor << 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary shift right",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor >> 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary unsigned shift",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor >>> 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary and",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor & 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary or",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor | 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
    {
      name: "reports a listener for numeric binary xor",
      source:
        "import { useEffect } from 'react';\nconst values = ['x']; const cursor = 0; const caption = values[cursor ^ 1]; const text = `${caption}`;\nconst install = () => { document.addEventListener('pointermove', () => {}); };\nconst prepare = () => { install(); };\nexport const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return <section/>; };\n",
      expected: 1,
      messagePrefix: null,
    },
  ]) {
    it(testCase.name, () => {
      const result = runRule(effectNeedsCleanup, testCase.source, { filename: "fixture.tsx" });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expected);
      if (testCase.messagePrefix !== null) {
        expect(result.diagnostics[0]?.message.startsWith(testCase.messagePrefix)).toBe(true);
      }
    });
  }

  it("keeps provider results separate across clean and mutated parses", () => {
    const source = [
      'import { useEffect } from "react";',
      'const attach = () => { document.addEventListener("pointermove", () => {}); };',
      "const prepare = () => { attach(); };",
      "export const Panel = () => { useEffect(() => { prepare(); return () => {}; }, []); return null; };",
    ].join("\n");
    for (const { program, expected } of [
      { program: source, expected: 1 },
      { program: "document.addEventListener = replacement;\n" + source, expected: 0 },
      { program: source, expected: 1 },
    ]) {
      const result = runRule(effectNeedsCleanup, program);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    }
  });

  it("keeps listener-specific cancellation separate between effects", () => {
    const source = [
      'import { useEffect } from "react";',
      "let active = true;",
      'const attachResize = () => { window.addEventListener("resize", () => {}); };',
      "const prepareResize = () => { attachResize(); };",
      'const attachMove = () => { document.addEventListener("pointermove", () => { if (active) console.info("moving"); }); };',
      "const prepareMove = () => { attachMove(); };",
      "export const Panel = () => {",
      "  useEffect(() => { prepareResize(); return () => {}; }, []);",
      "  useEffect(() => { prepareMove(); return () => { active = false; }; }, []);",
      "  return null;",
      "};",
    ].join("\n");
    const result = runRule(effectNeedsCleanup, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.line).toBe(8);
  });
});
