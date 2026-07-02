import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

// Must-detect anchor distilled from the inrupt solid-ui-react Image
// component (the 0.5.7 -> 0.5.8 regression review). The trap: an async React event handler that calls the
// setter is still a React event handler — it must NOT mark the state
// externally driven and silence the onError-in-effect report.

describe("no-prop-callback-in-effect — must-detect regressions", () => {
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
