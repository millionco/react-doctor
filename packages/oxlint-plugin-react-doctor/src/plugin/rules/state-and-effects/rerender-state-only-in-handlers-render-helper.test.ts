import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers render-invoked helpers", () => {
  it.each([
    "const connect = () => connection(); connect();",
    "const connect = () => publish(void connection.subscribe()); connect();",
    "const connect = () => new connection(); connect();",
    "const connect = () => { if (connection) connection.subscribe(); }; connect();",
    "function connect() { if (connection) connection.subscribe(); } connect();",
    "function connect() { connection?.subscribe(); } connect.description = 'ready'; connect();",
    "function connect() { connection(); } connect.description = 'ready'; connect();",
    "function connect() { connection?.subscribe(); } [connect.description] = ['ready']; connect();",
    "function connect() { connection?.subscribe(); } let value; ({ [connect]: value } = {}); connect();",
    "function connect() { connection?.subscribe(); } let value; [value = connect] = []; connect();",
    "const connect = () => connection?.subscribe(); connect.description = 'ready'; connect();",
    "{ function connect() { connection?.subscribe(); } connect(); }",
    "const connect = () => { if (connection) connection.subscribe(); }; const start = () => connect(); start();",
    "const connect = () => { if (connection) connection.subscribe(); }; const start = connect; start();",
    "(() => { if (connection) connection.subscribe(); })();",
    "const connect = () => { if (connection) connection.subscribe(); }; if (enabled) connect();",
    'const connect = () => { try { throw new Error("Retry"); } catch { connection?.subscribe(); } }; connect();',
    "const connect = async () => { await ready(); if (connection) connection.subscribe(); }; connect();",
  ])("preserves state read by a render-invoked helper: %s", (helper) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [connection, setConnection] = useState(null);
        ${helper}
        return <button onClick={() => setConnection(createConnection())}>Connect</button>;
      }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const read = () => connection; read();",
    "const read = () => Math.abs(connection); read();",
    "const connect = () => publish(connection); connect();",
    "const connect = () => publish((ignored, connection)); connect();",
    "const connect = () => new Channel(connection); connect();",
    "const read = () => publish((connection, 1)); read();",
    "const read = () => publish(void connection); read();",
    "const read = () => { const unused = connection; publish(); }; read();",
    "const connect = () => { if (connection) connection.subscribe(); };",
    "const connect = () => { if (connection) connection.subscribe(); }; setTimeout(connect, 0);",
    "const connect = () => { if (connection) connection.subscribe(); }; Promise.resolve().then(connect);",
    "const connect = () => { if (connection) connection.subscribe(); }; useEffect(() => { connect(); }, []);",
    "const connect = () => { setTimeout(() => connection?.subscribe(), 0); }; connect();",
    "const connect = () => { Promise.resolve().then(() => connection?.subscribe()); }; connect();",
    "const connect = (connection) => { if (connection) connection.subscribe(); }; connect(externalConnection);",
    "let connect = () => { if (connection) connection.subscribe(); }; connect = () => {}; connect();",
    "function* connect() { if (connection) connection.subscribe(); } connect();",
    "function connect() { connection?.subscribe(); } [connect] = [() => {}]; connect();",
    "function connect() { connection?.subscribe(); } ({ connect } = { connect: () => {} }); connect();",
    "function connect() { connection?.subscribe(); } [connect = () => {}] = []; connect();",
    "function connect() { connection?.subscribe(); } for (connect of [() => {}]) {} connect();",
    "function connect() { connection?.subscribe(); } [connect] = [() => {}]; const start = connect; start();",
    "function connect() { connection?.subscribe(); } [connect] = [() => {}]; [1].forEach(connect);",
    "function subscribe() { connection?.subscribe(); } function connect() { subscribe(); } [connect] = [() => {}]; connect();",
  ])("retains the existing warning outside the receiver/callee exception: %s", (helper) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [connection, setConnection] = useState(null);
        ${helper}
        return <button onClick={() => setConnection(createConnection())}>Connect</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const connect = () => connection?.subscribe(); return <button onClick={() => setConnection(null)}>Reset</button>; connect();",
    "const connect = () => connection?.subscribe(); const start = () => { return; connect(); }; start();",
    "const connect = () => { return; connection?.subscribe(); }; connect();",
  ])("retains state when render-helper consumption is unreachable: %s", (helper) => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [connection, setConnection] = useState(null);
        ${helper}
        return <button onClick={() => setConnection(createConnection())}>Connect</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("retains state consumed only by an event handler", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Panel() {
        const [connection, setConnection] = useState(null);
        const connect = () => { connection?.subscribe(); setConnection(createConnection()); };
        return <button onClick={connect}>Connect</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
