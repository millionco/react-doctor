import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

// Must-detect anchor distilled from the inrupt solid-ui-react Image
// component (the 0.5.7 -> 0.5.8 regression review). The trap: an async React event handler that calls the
// setter is still a React event handler — it must NOT mark the state
// externally driven and silence the onError-in-effect report.

describe("no-prop-callback-in-effect — must-detect regressions", () => {
  it("preserves local-state flow through direct React useEffectEvent wrappers", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `import { useEffect, useEffectEvent, useState } from "react";
      const Child = ({ onChange }) => {
        const [value] = useState("");
        const notify = useEffectEvent(onChange);
        useEffect(() => {
          notify(value);
        }, [value]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust an imported useEffectEvent polyfill", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `import { useEffectEvent } from "effect-event-polyfill";
      const Child = ({ onChange }) => {
        const [value] = useState("");
        const notify = useEffectEvent(onChange);
        useEffect(() => notify(value), [value]);
        return null;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires on onError(error) in an effect when the setter is also called in async handlers (inrupt Image)", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `
      const Image = ({ thing, property, onError, onSave, maxSize }: Props) => {
        const values = useProperty({ thing, property, type: 'url' });
        const { value, error: thingError } = values;
        let valueError;
        if (!value) {
          valueError = new Error('No value found for property.');
        }
        const [error, setError] = useState(thingError ?? valueError);

        useEffect(() => {
          if (error) {
            if (onError) {
              onError(error);
            }
          }
        }, [error, onError]);

        const handleDelete = async () => {
          try {
            await deleteImage(value);
          } catch (deleteError) {
            setError(deleteError);
          }
        };

        const handleChange = async (input) => {
          const fileSelected = input.files && input.files[0];
          try {
            await saveImage(fileSelected);
            if (onSave) {
              onSave();
            }
          } catch (saveError) {
            setError(saveError);
          }
        };

        return (
          <div>
            <input onChange={(event) => handleChange(event.target)} />
            <button onClick={handleDelete}>Delete</button>
          </div>
        );
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].message).toContain('"onError"');
  });

  it("stays silent when the prop is a pure transform whose result feeds a local setter", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ validate }) {
        const [value, setValue] = useState('');
        const [error, setError] = useState(null);
        useEffect(() => { setError(validate(value)); }, [value]);
        return <input onChange={(event) => setValue(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when every state-shape dep is set only by a WebSocket message handler", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `const Live = ({ url, onMsg }) => {
        const [msg, setMsg] = useState(null);
        useEffect(() => {
          const ws = new WebSocket(url);
          ws.onmessage = (event) => setMsg(event.data);
          return () => ws.close();
        }, [url]);
        useEffect(() => {
          if (msg) onMsg(msg);
        }, [msg, onMsg]);
        return <div />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("no-prop-callback-in-effect — regressions", () => {
  it("treats inline and named prop-derived dependencies identically", () => {
    const inlineResult = runRule(
      noPropCallbackInEffect,
      `function MultiSelectField({ values, onPendingChange }) {
        useEffect(() => {
          onPendingChange(values);
        }, [JSON.stringify(values)]);
        return null;
      }`,
    );
    const namedResult = runRule(
      noPropCallbackInEffect,
      `function MultiSelectField({ values, onPendingChange }) {
        const valuesKey = JSON.stringify(values);
        useEffect(() => {
          onPendingChange(values);
        }, [valuesKey]);
        return null;
      }`,
    );

    expect(inlineResult.parseErrors).toEqual([]);
    expect(namedResult.parseErrors).toEqual([]);
    expect(inlineResult.diagnostics).toEqual([]);
    expect(namedResult.diagnostics).toEqual([]);
  });

  it("flags a genuine local-state mirror through direct and callback-ref calls", () => {
    const directResult = runRule(
      noPropCallbackInEffect,
      `function MultiSelectField({ onPendingChange }) {
        const [draft, setDraft] = useState([]);
        const draftKey = JSON.stringify(draft);
        useEffect(() => {
          onPendingChange(draft);
        }, [draftKey]);
        return null;
      }`,
    );
    const refResult = runRule(
      noPropCallbackInEffect,
      `function MultiSelectField({ onPendingChange }) {
        const [draft, setDraft] = useState([]);
        const draftKey = JSON.stringify(draft);
        const onPendingChangeRef = useRef(onPendingChange);
        useEffect(() => {
          onPendingChangeRef.current?.(draft);
        }, [draftKey]);
        return null;
      }`,
    );

    expect(directResult.parseErrors).toEqual([]);
    expect(refResult.parseErrors).toEqual([]);
    expect(directResult.diagnostics).toHaveLength(1);
    expect(refResult.diagnostics).toHaveLength(1);
  });

  it("flags callback-ref mirrors through transparent receiver wrappers", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function MultiSelectField({ onPendingChange }) {
        const [draft, setDraft] = useState([]);
        const onPendingChangeRef = useRef(onPendingChange);
        useEffect(() => {
          (onPendingChangeRef as any).current(draft);
          (onPendingChangeRef!).current(draft);
        }, [draft]);
        return null;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent when the prop is a pure transform consumed locally", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ validate }) {
        const [value] = useState("");
        const [error, setError] = useState(null);
        useEffect(() => { setError(validate(value)); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a discarded prop callback that syncs the parent", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        useEffect(() => { onChange(value); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the guarded call spelling onChange && onChange(value)", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        useEffect(() => { onChange && onChange(value); }, [value]);
        return <input onChange={(event) => setValue(event.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags state also written from an async click handler (inrupt image)", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Image({ onError, errorComponent: ErrorComponent, value, fetch }) {
        const [error, setError] = useState(undefined);
        useEffect(() => {
          if (error) {
            if (onError) {
              onError(error);
            }
          }
        }, [error, onError, ErrorComponent]);
        const handleDelete = async () => {
          try {
            await deleteFile(value, { fetch });
          } catch (thrown) {
            setError(thrown);
          }
        };
        return <button onClick={handleDelete} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the minimal async-handler-setter shape", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        useEffect(() => { onChange(value); }, [value]);
        const load = async () => {
          const next = await fetchValue();
          setValue(next);
        };
        return <button onClick={load} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the synced state is exclusively listener-driven", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Sidebar({ onMobileChange }) {
        const [mobile, setMobile] = useState(false);
        useEffect(() => {
          const handleResize = () => setMobile(window.innerWidth < 768);
          window.addEventListener("resize", handleResize);
          return () => window.removeEventListener("resize", handleResize);
        }, []);
        useEffect(() => { onMobileChange(mobile); }, [mobile]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation r2: AlbumRow (notifyRestoreCompletePendingRef) and
  // CanonCard (settledRef) — a ref latch read in the guard and written
  // in the effect makes it a one-shot completion signal, not a mirror.
  it("stays silent for a ref-latch-guarded one-shot completion callback", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function AlbumRow({ onScrollRestoreComplete }) {
        const [artworkBudget, setArtworkBudget] = useState(0);
        const notifyPendingRef = useRef(false);
        useLayoutEffect(() => {
          if (!notifyPendingRef.current) return;
          notifyPendingRef.current = false;
          onScrollRestoreComplete?.();
        }, [artworkBudget, onScrollRestoreComplete]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a settledRef-deduped subscription completion event", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function CanonCard({ entry, onJobCompleted, onJobFailed }) {
        const [inFlightJobId, setInFlightJobId] = useState(null);
        const { status, filename, error } = useMediaJobProgress(inFlightJobId);
        const settledRef = useRef(null);
        useEffect(() => {
          if (!inFlightJobId) { settledRef.current = null; return; }
          if (settledRef.current === inFlightJobId) return;
          if (status === 'completed' && filename) {
            settledRef.current = inFlightJobId;
            onJobCompleted?.(entry.id, filename, inFlightJobId);
          } else if (status === 'failed') {
            settledRef.current = inFlightJobId;
            onJobFailed?.(entry.id, error || status, inFlightJobId);
          }
        }, [inFlightJobId, status, filename, error, entry.id, onJobCompleted, onJobFailed]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Docs-validation r2: LocalSetupPanel — a usePrevious dep means the
  // effect is an edge-triggered transition detector, not a state mirror.
  it("stays silent for a usePrevious edge-triggered notification", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function LocalSetupPanel({ onPackagesChanged }) {
        const [check, setCheck] = useState(null);
        const allInstalled = !!check && check.missing.length === 0;
        const hadMissing = !!check && check.missing.length > 0;
        const prevHadMissing = usePrevious(hadMissing, false);
        useEffect(() => {
          if (allInstalled && prevHadMissing) onPackagesChanged?.();
        }, [allInstalled, prevHadMissing, onPackagesChanged]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mirror effect that merely reads (never writes) a ref", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        const mountedRef = useRef(true);
        useEffect(() => {
          if (mountedRef.current) onChange(value);
        }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the synced state is driven by a WebSocket onmessage handler", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Live({ url, onMsg }) {
        const [msg, setMsg] = useState(null);
        useEffect(() => {
          const ws = new WebSocket(url);
          ws.onmessage = (event) => setMsg(event.data);
          return () => ws.close();
        }, [url]);
        useEffect(() => {
          if (msg) onMsg?.(msg);
        }, [msg]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
