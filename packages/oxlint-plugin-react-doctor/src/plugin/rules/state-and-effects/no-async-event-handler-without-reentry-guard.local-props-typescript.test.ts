import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

const scenarios = [
  {
    name: "as-any event and request receivers",
    receiver: "(api as any)",
    event: "(event as any)",
    expected: 1,
  },
  { name: "non-null event and request receivers", receiver: "api!", event: "event!", expected: 1 },
  {
    name: "satisfies event and request receivers",
    receiver: "(api satisfies unknown)",
    event: "(event satisfies unknown)",
    expected: 1,
  },
  {
    name: "nested transparent request receivers",
    receiver: "((api as any)!)",
    event: "event",
    expected: 1,
  },
  {
    name: "wrapped busy guard remains guarded",
    receiver: "(api as any)",
    event: "event!",
    guard: "if (busy) return;",
    expected: 0,
  },
  {
    name: "wrapped local storage is not a network request",
    receiver: "(db as any)",
    event: "event!",
    expected: 0,
  },
  {
    name: "non-null local storage is not a network request",
    receiver: "db!",
    event: "event",
    expected: 0,
  },
  {
    name: "wrapped nested local storage remains excluded",
    receiver: "(db as any).items",
    event: "event",
    expected: 0,
  },
  {
    name: "wrapped preview endpoint remains non-mutating",
    receiver: "(api as any)",
    event: "event!",
    url: "/preview",
    expected: 0,
  },
  {
    name: "wrapped provider mutation cannot authorize state",
    receiver: "(api as any)",
    event: "event!",
    prefix: "(require as any)('react').useState = () => [false, () => {}];",
    expected: 0,
  },
  {
    name: "unrelated parameter annotation preserves the verdict",
    receiver: "(api as any)",
    event: "event!",
    prefix: "const typed = (value: number) => value;",
    expected: 1,
  },
  {
    name: "unrelated interfaces remain unsupported",
    receiver: "(api as any)",
    event: "event!",
    prefix: "interface Unused {}",
    expected: 0,
  },
  {
    name: "type-only imports remain unsupported",
    receiver: "(api as any)",
    event: "event!",
    prefix: "import type {Unused} from 'types';",
    expected: 0,
  },
];

describe("local host props with transparent TypeScript receivers", () => {
  it.each(scenarios)(
    "$name",
    ({ receiver, event, guard = "", url = "/items", prefix = "", expected }) => {
      const code = `import {useState} from "react"; import api from "example-client"; import db from "example-store"; ${prefix}
      export const Example = () => { const [ready, setReady] = useState(false); const [busy] = useState(false);
        const send = async event => { ${guard} (${event}).preventDefault(); await (${receiver}).post("${url}"); setReady(true); };
        return <Forward onSend={send}/>; };
      const Forward = ({onSend}) => <form onSubmit={onSend}/>;`;
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, code, {
        filename: "native.tsx",
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
});
