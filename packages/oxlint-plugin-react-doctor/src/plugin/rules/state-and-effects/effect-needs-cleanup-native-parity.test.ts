import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup — native traversal and ownership parity", () => {
  it.each([
    {
      name: "fluent-on-subscribe-message",
      source:
        "import { useEffect } from 'react'; export function Child({ channel, handler }) { useEffect(() => { channel.on('change', handler).subscribe(handler); }, [channel, handler]); return null; }",
      expectedDiagnostics: [
        {
          column: 81,
          line: 1,
          message:
            "`subscribe` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "fluent-subscribe-on-message",
      source:
        "import { useEffect } from 'react'; export function Child({ channel, handler }) { useEffect(() => { channel.subscribe(handler).on('change', handler); }, [channel, handler]); return null; }",
      expectedDiagnostics: [
        {
          column: 81,
          line: 1,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "separate-on-subscribe-message",
      source:
        "import { useEffect } from 'react'; export function Child({ channel, handler }) { useEffect(() => { channel.on('change', handler); channel.subscribe(handler); }, [channel, handler]); return null; }",
      expectedDiagnostics: [
        {
          column: 81,
          line: 1,
          message:
            "`on` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "fluent-subscription-channel-removal-message",
      source:
        "import { useEffect } from 'react'; export function Child({ client, handler }) { useEffect(() => { const channel = client.channel('room'); channel.on('change', {}, handler).subscribe(handler); return () => { client.removeChannel(channel); }; }, [client, handler]); return null; }",
      expectedDiagnostics: [
        {
          column: 80,
          line: 1,
          message:
            "`subscribe` creates a subscription in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "direct-event-source-cleanup",
      source:
        "import { useEffect } from 'react'; export function Child({ url }) { useEffect(() => { const connection = new EventSource(url); return () => connection.close(); }, [url]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "single-helper-event-source-cleanup",
      source:
        "import { useEffect } from 'react'; export function Child({ url }) { useEffect(() => { let connection = null; const connect = () => { connection = new EventSource(url); }; connect(); return () => connection?.close(); }, [url]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "repeated-helper-event-source-cleanup",
      source:
        "import { useEffect } from 'react'; export function Child({ url }) { useEffect(() => { let connection = null; const connect = () => { connection = new EventSource(url); }; connect(); connect(); return () => connection?.close(); }, [url]); return null; }",
      expectedDiagnostics: [
        {
          column: 68,
          line: 1,
          message:
            "`EventSource` creates a connection in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "deferred-helper-event-source-cleanup",
      source:
        "import { useEffect } from 'react'; export function Child({ url }) { useEffect(() => { let connection = null; const connect = () => { connection = new EventSource(url); }; connect(); const timer = setTimeout(connect, 1000); return () => { clearTimeout(timer); connection?.close(); }; }, [url]); return null; }",
      expectedDiagnostics: [
        {
          column: 68,
          line: 1,
          message:
            "`EventSource` creates a connection in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "guarded-reconnecting-event-source-cleanup",
      source:
        "import { useEffect, useRef } from 'react'; export function Child({ url }) { const timer = useRef(null); useEffect(() => { let connection = null; let mounted = true; const connect = () => { if (!mounted) return; connection = new EventSource(url); connection.onerror = () => { if (!mounted) return; connection?.close(); connection = null; timer.current = setTimeout(() => { if (mounted) connect(); }, 1000); }; }; connect(); return () => { mounted = false; connection?.close(); clearTimeout(timer.current); }; }, [url]); return null; }",
      expectedDiagnostics: [
        {
          column: 104,
          line: 1,
          message:
            "`EventSource` creates a connection in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "single-guarded-helper-event-source-cleanup",
      source:
        "import { useEffect } from 'react'; export function Child({ url }) { useEffect(() => { let connection = null; let mounted = true; const connect = () => { if (!mounted) return; connection = new EventSource(url); }; connect(); return () => { mounted = false; connection?.close(); }; }, [url]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "repeated-helper-with-prior-release",
      source:
        "import { useEffect } from 'react'; export function Child({ url }) { useEffect(() => { let connection = null; const connect = () => { connection?.close(); connection = new EventSource(url); }; connect(); connect(); return () => connection?.close(); }, [url]); return null; }",
      expectedDiagnostics: [
        {
          column: 68,
          line: 1,
          message:
            "`EventSource` creates a connection in useEffect without guaranteed cleanup. Return a cleanup function that owns every allocation so it does not leak after unmount.",
          nodeType: "CallExpression",
        },
      ],
    },
  ])("$name", ({ source, expectedDiagnostics }) => {
    const result = runRule(effectNeedsCleanup, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
