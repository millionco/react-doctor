import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers — render-time collection merges", () => {
  it("accepts state merged into a rendered Map", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings({ apiKeys }) {
        const [localApiKeys, setLocalApiKeys] = useState([]);
        const mergedById = new Map(apiKeys.map((apiKey) => [apiKey.id, apiKey]));
        localApiKeys.forEach((apiKey) => mergedById.set(apiKey.id, apiKey));
        return <button onClick={() => setLocalApiKeys([])}>
          {[...mergedById.values()].map((apiKey) => <span>{apiKey.id}</span>)}
        </button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports handler-only state", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Tracker() {
        const [lastEvent, setLastEvent] = useState(null);
        return <button onClick={(event) => setLastEvent(event)}>Track</button>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
