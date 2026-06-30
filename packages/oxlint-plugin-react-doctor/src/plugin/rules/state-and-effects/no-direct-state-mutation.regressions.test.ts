import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

describe("no-direct-state-mutation — regressions", () => {
  it("stays silent on a mutating method against an opaque third-party instance", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Playlist() {
        const [queue, setQueue] = useState(() => new TrackQueue());
        const enqueue = (track) => { queue.push(track); player.update(); };
        return <button onClick={() => enqueue(current)}>Add</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mutating method against array-literal state", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List() {
        const [items, setItems] = useState([]);
        const add = (x) => { items.push(x); };
        return <button onClick={() => add(1)}>{items.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("items");
  });

  // Bugbot: a lazy initializer returning an object/array literal is the same
  // render-owned state as the direct form, so its mutations must still flag.
  it("flags mutation of state from a lazy array initializer", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List() {
        const [items, setItems] = useState(() => []);
        const add = (x) => { items.push(x); };
        return <button onClick={() => add(1)}>{items.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("items");
  });

  it("flags mutation of state from a lazy object initializer with a block body", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Form() {
        const [draft, setDraft] = useState(() => { return {}; });
        const touch = () => { draft.dirty = true; };
        return <button onClick={touch}>save</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("draft");
  });
});
