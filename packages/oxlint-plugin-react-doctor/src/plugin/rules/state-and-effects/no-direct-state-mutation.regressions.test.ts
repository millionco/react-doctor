import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

describe("no-direct-state-mutation — regressions", () => {
  it("stays silent on a mutating method against a lazily constructed instance", () => {
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

  it("stays silent on a lazy block-body initializer returning an instance", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Playlist() {
        const [queue, setQueue] = useState(() => { return new TrackQueue(); });
        const enqueue = (track) => { queue.push(track); };
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

  it("flags mutation of a TS-cast array-literal initializer", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List() {
        const [items, setItems] = useState([] as Item[]);
        const add = (x: Item) => { items.push(x); };
        return <button onClick={() => add(next)}>{items.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("items");
  });

  it("flags mutation of prop-sourced array state", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List(props) {
        const [items, setItems] = useState(props.initialItems);
        const add = (x) => { items.push(x); };
        return <button onClick={() => add(1)}>{items.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("items");
  });

  it("flags in-place writes to null-initialized editor state (wangeditor bench shape)", () => {
    const result = runRule(
      noDirectStateMutation,
      `function EditorComponent(props: Partial<IProps>) {
        const { value = '', onChange, defaultConfig = {}, mode = 'default' } = props;
        const ref = useRef<HTMLDivElement | null>(null);
        const latestHtmlRef = useRef('');
        const [editor, setEditor] = useState<ICustomDomEditor | null>(null);

        useEffect(() => {
          if (editor == null) { return }

          editor.__react_on_change = (e: IDomEditor) => {
            latestHtmlRef.current = e.getHtml();
            if (onChange) { onChange(e) }
          };
          return () => {
            editor.__react_on_change = undefined;
          };
        }, [editor, defaultConfig, onChange]);

        useEffect(() => {
          if (ref.current == null) { return }
          if (editor != null) { return }

          const newEditor = createEditor({
            selector: ref.current,
            config: {
              ...defaultConfig,
              onChange: (e: IDomEditor) => newEditor?.__react_on_change?.(e),
            },
            html: value,
            mode,
          }) as ICustomDomEditor;
          setEditor(newEditor);
        }, [editor, defaultConfig, mode, value]);

        return <div ref={ref} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].message).toContain("editor");
    expect(result.diagnostics[1].message).toContain("editor");
  });
});
