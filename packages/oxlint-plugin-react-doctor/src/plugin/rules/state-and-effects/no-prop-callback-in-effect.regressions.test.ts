import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

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

  it("flags state also written from an async click handler (bench: inrupt image)", () => {
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
