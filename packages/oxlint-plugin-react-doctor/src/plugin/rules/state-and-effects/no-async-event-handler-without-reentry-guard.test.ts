import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "./no-async-event-handler-without-reentry-guard.js";

describe("no-async-event-handler-without-reentry-guard", () => {
  it("flags an onSubmit handler that POSTs then sets state with no guard", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Signup() {
        async function handleSubmit(event) {
          event.preventDefault();
          const res = await fetch('/api/signup', { method: 'POST', body });
          setSubmitted(true);
        }
        return <form onSubmit={handleSubmit} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an onClick arrow that awaits api.post then sets state", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function List({ id, email }) {
        const onSubscribe = async () => {
          await api.post(\`/lists/\${id}/subscribe\`, { email });
          setJoined(true);
        };
        return <button onClick={onSubscribe}>Subscribe</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline async onSubmit with a PATCH before any state flip", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `const Form = () => (
        <form onSubmit={async () => {
          await fetch('/api/reset', { method: 'PATCH', body });
          setDone(true);
        }} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an idempotent clipboard copy", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Terminal({ text }) {
        const handleCopy = async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        };
        return <button onClick={handleCopy} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the leading setLoading(true) loading-flag pattern", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function PasswordForm() {
        async function onSubmit() {
          setLoading(true);
          try {
            await fetch('/api/password', { method: 'PUT', body });
          } finally {
            setLoading(false);
          }
        }
        return <button disabled={loading} onClick={onSubmit}>Save</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a leading if (busy) return guard", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Modal() {
        async function submit() {
          if (sending) return;
          setSending(true);
          await fetch('/api/x', { method: 'POST' });
          setDone(true);
        }
        return <button onClick={submit} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-mutating GET read", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Feed() {
        async function loadMore() {
          const rows = await fetch('/api/items').then((response) => response.json());
          setItems(rows);
        }
        return <button onClick={loadMore} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a synchronous (non-async) handler", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Sync() {
        const onSubscribe = () => {
          api.post('/x', {});
          setJoined(true);
        };
        return <button onClick={onSubscribe} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when there is no post-await state setter", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Fire() {
        async function submit() {
          await fetch('/api/x', { method: 'POST' });
        }
        return <button onClick={submit} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the only post-await call is a setTimeout toast dismiss, not a state setter", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        async function handleSave() {
          await api.post('/save', payload);
          setTimeout(closeToast, 2000);
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a leading setTimeout as a loading-flag guard", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        async function handleSave() {
          setTimeout(logAttempt, 0);
          await api.post('/save', payload);
          setSaved(true);
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a fire-and-report handler whose only setter is error handling in catch", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        async function handleSave() {
          try {
            await api.post('/save', payload);
          } catch (error) {
            setError(error);
          }
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a try/catch-wrapped POST whose state flip follows the await in the same try block", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save() {
        async function handleSave() {
          try {
            await fetch('/api/save', { method: 'POST' });
            setSaved(true);
          } catch (err) {
            setError(err);
          }
        }
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a useCallback-wrapped async handler that POSTs then sets state", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        const handleSave = useCallback(async () => {
          await api.post('/save', payload);
          setSaved(true);
        }, [payload]);
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a guarded useCallback handler with a leading busy early return", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Save({ payload }) {
        const handleSave = useCallback(async () => {
          if (saving) return;
          setSaving(true);
          await api.post('/save', payload);
          setSaved(true);
        }, [payload, saving]);
        return <button onClick={handleSave} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-reentry-guarded event handler such as onChange", () => {
    const result = runRule(
      noAsyncEventHandlerWithoutReentryGuard,
      `function Input() {
        async function onChangeHandler() {
          await fetch('/api/x', { method: 'POST' });
          setValue(true);
        }
        return <input onChange={onChangeHandler} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
