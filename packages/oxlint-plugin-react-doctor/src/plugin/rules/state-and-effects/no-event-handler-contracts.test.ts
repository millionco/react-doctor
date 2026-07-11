import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEventHandler } from "./no-event-handler.js";
import { noEventTriggerState } from "./no-event-trigger-state.js";

const expectEventHandlerDiagnostics = (code: string, diagnosticCount: number): void => {
  const result = runRule(noEventHandler, code, { forceJsx: true });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(diagnosticCount);
};

describe("no-event-handler event-source contract", () => {
  it("reports handler-proven state that guards transferable effect work", () => {
    expectEventHandlerDiagnostics(
      `function Form({ onSubmit }) {
        const [submitted, setSubmitted] = useState(false);
        useEffect(() => {
          if (submitted) onSubmit();
        }, [submitted, onSubmit]);
        return <button onClick={() => setSubmitted(true)}>Submit</button>;
      }`,
      1,
    );
  });

  it("reports a state writer behind one handler helper frame", () => {
    expectEventHandlerDiagnostics(
      `function Form() {
        const [submitted, setSubmitted] = useState(false);
        const markSubmitted = () => setSubmitted(true);
        const handleSubmit = () => markSubmitted();
        useEffect(() => {
          if (submitted) post("/submit");
        }, [submitted]);
        return <button onClick={handleSubmit}>Submit</button>;
      }`,
      1,
    );
  });

  it("stays silent for prop-only guards", () => {
    expectEventHandlerDiagnostics(
      `function Dialog({ open, onOpen }) {
        useEffect(() => {
          if (open) onOpen();
        }, [open, onOpen]);
        return null;
      }`,
      0,
    );
  });

  it("stays silent for externally driven and mixed-origin state", () => {
    expectEventHandlerDiagnostics(
      `function Connection({ socket }) {
        const [connected, setConnected] = useState(false);
        useEffect(() => {
          socket.on("connect", () => setConnected(true));
          return () => socket.off("connect");
        }, [socket]);
        useEffect(() => {
          if (connected) post("/connected");
        }, [connected]);
        return <button onClick={() => setConnected(false)}>Disconnect</button>;
      }`,
      0,
    );
  });

  it("does not confuse a shadowed setter with handler evidence", () => {
    expectEventHandlerDiagnostics(
      `function Form() {
        const [submitted, setSubmitted] = useState(false);
        const Inner = () => {
          const [value, setSubmitted] = useState(false);
          return <button onClick={() => setSubmitted(true)}>{value}</button>;
        };
        useEffect(() => {
          if (submitted) post("/submit");
        }, [submitted]);
        return <Inner />;
      }`,
      0,
    );
  });

  it("keeps no-event-trigger-state on the same handler proof", () => {
    const result = runRule(
      noEventTriggerState,
      `function Form() {
        const [payload, setPayload] = useState(null);
        useEffect(() => {
          if (payload) {
            post("/submit", payload);
          }
        }, [payload]);
        return <button onClick={() => setPayload({ ready: true })}>Submit</button>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
