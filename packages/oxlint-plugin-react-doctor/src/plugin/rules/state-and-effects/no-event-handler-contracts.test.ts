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

  it("stays silent when a JSX handler helper is also called by an effect", () => {
    const code = `function Form({ automatic }) {
      const [submitted, setSubmitted] = useState(false);
      const markSubmitted = () => setSubmitted(true);
      useEffect(() => {
        if (automatic) markSubmitted();
      }, [automatic]);
      useEffect(() => {
        if (submitted) post("/submit");
      }, [submitted]);
      return <button onClick={markSubmitted}>Submit</button>;
    }`;
    expectEventHandlerDiagnostics(code, 0);
    const triggerResult = runRule(noEventTriggerState, code, { forceJsx: true });
    expect(triggerResult.parseErrors).toEqual([]);
    expect(triggerResult.diagnostics).toEqual([]);
  });

  it("stays silent when transferable work has an external readiness guard", () => {
    expectEventHandlerDiagnostics(
      `function Form({ onSubmit, socket }) {
        const [clicked, setClicked] = useState(false);
        const [ready, setReady] = useState(false);
        useEffect(() => {
          socket.on("ready", () => setReady(true));
          return () => socket.off("ready");
        }, [socket]);
        useEffect(() => {
          if (clicked) {
            if (ready) onSubmit();
          }
        }, [clicked, onSubmit, ready]);
        return <button onClick={() => setClicked(true)}>Submit</button>;
      }`,
      0,
    );
  });

  it("does not use a shadowed JSX setter name as handler proof", () => {
    expectEventHandlerDiagnostics(
      `function Form() {
        const [submitted, setSubmitted] = useState(false);
        useEffect(() => {
          setSubmitted(true);
        }, []);
        useEffect(() => {
          if (submitted) post("/submit");
        }, [submitted]);
        {
          const setSubmitted = () => post("/click");
          return <button onClick={setSubmitted}>Submit</button>;
        }
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

  it("keeps no-event-trigger-state through a React effect import alias", () => {
    const result = runRule(
      noEventTriggerState,
      `import { useEffect as useSynchronize, useState } from "react";
      function Form() {
        const [payload, setPayload] = useState(null);
        useSynchronize(() => {
          if (payload) post("/submit", payload);
        }, [payload]);
        return <button onClick={() => setPayload({ ready: true })}>Submit</button>;
      }`,
      { forceJsx: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
