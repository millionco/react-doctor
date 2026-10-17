import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

const scenarios = [
  {
    name: "direct fulfilled request with as-any receivers",
    receiver: "(api as any)",
    event: "(event as any)",
    local: false,
    expected: 1,
  },
  {
    name: "local-prop fulfilled request with as-any receivers",
    receiver: "(api as any)",
    event: "event",
    local: true,
    expected: 1,
  },
  {
    name: "direct fulfilled request with non-null receivers",
    receiver: "api!",
    event: "event!",
    local: false,
    expected: 1,
  },
  {
    name: "local-prop fulfilled request with non-null receivers",
    receiver: "api!",
    event: "event!",
    local: true,
    expected: 1,
  },
  {
    name: "fulfilled request with satisfies receiver",
    receiver: "(api satisfies unknown)",
    event: "event",
    local: false,
    expected: 1,
  },
  {
    name: "fulfilled local storage remains excluded",
    receiver: "(db as any)",
    event: "event",
    local: true,
    expected: 0,
  },
  {
    name: "fulfilled preview remains excluded",
    receiver: "api!",
    event: "event",
    local: false,
    url: "/preview",
    expected: 0,
  },
  {
    name: "fulfilled leading busy guard remains guarded",
    receiver: "(api as any)",
    event: "event!",
    local: true,
    guard: "if(busy) return;",
    expected: 0,
  },
  {
    name: "async fulfillment remains unsupported",
    receiver: "api!",
    event: "event",
    local: true,
    fulfillment: "then(async () => { setReady(true); })",
    expected: 0,
  },
  {
    name: "rejection callback is not fulfillment",
    receiver: "(api as any)",
    event: "event",
    local: false,
    fulfillment: "catch(() => { setReady(true); })",
    expected: 0,
  },
];

describe("awaited fulfillment with transparent TypeScript receivers", () => {
  it.each(scenarios)(
    "$name",
    ({
      receiver,
      event,
      local,
      url = "/items",
      guard = "",
      fulfillment = "then(() => { setReady(true); })",
      expected,
    }) => {
      const code = `import {useState} from "react"; import api from "example-client"; import db from "example-store";
   export const Example = () => { const[ready,setReady]=useState(false); const[busy]=useState(false);
    const send = async event => { ${guard} (${event}).preventDefault(); await (${receiver}).post("${url}").${fulfillment}; };
    return ${local ? "<Forward onSend={send}/>" : "<form onSubmit={send}/>"}; };
   const Forward=({onSend})=><form onSubmit={onSend}/>;`;
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, code, {
        filename: "native.tsx",
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
});
