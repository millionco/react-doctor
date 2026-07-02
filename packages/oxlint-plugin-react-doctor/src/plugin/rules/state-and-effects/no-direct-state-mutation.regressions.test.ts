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

  it("flags the wangeditor shape: useState(null) mutated in an effect", () => {
    const result = runRule(
      noDirectStateMutation,
      `function EditorComponent(props) {
        const { defaultConfig = {}, onChange, value = '' } = props;
        const ref = useRef(null);
        const latestHtmlRef = useRef('');
        const [editor, setEditor] = useState(null);

        useEffect(() => {
          if (editor == null) { return }
          editor.__react_on_change = (e) => {
            const latestHtml = e.getHtml();
            latestHtmlRef.current = latestHtml;
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
            config: { ...defaultConfig },
            html: value,
          });
          setEditor(newEditor);
        }, [editor, defaultConfig, value]);

        return <div ref={ref} />;
      }`,
      { filename: "Editor.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags in-place writes to null-initialized editor state (wangeditor shape)", () => {
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

  it("flags mutation of TS-cast array-literal state: useState([] as string[])", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List() {
        const [items, setItems] = useState([] as string[]);
        const add = (x: string) => { items.push(x); };
        return <button onClick={() => add("a")}>{items.length}</button>;
      }`,
      { filename: "list.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("flags mutation of generic array-literal state: useState<string[]>([])", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List() {
        const [items, setItems] = useState<string[]>([]);
        const add = (x: string) => { items.push(x); };
        return <button onClick={() => add("a")}>{items.length}</button>;
      }`,
      { filename: "list.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutation of lazily-initialized TS-cast state: useState(() => [] as string[])", () => {
    const result = runRule(
      noDirectStateMutation,
      `function List() {
        const [items, setItems] = useState(() => [] as string[]);
        const add = (x: string) => { items.push(x); };
        return <button onClick={() => add("a")}>{items.length}</button>;
      }`,
      { filename: "list.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutation of undefined-initialized state: useState()", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Form() {
        const [draft, setDraft] = useState();
        const touch = () => { draft.dirty = true; };
        return <button onClick={touch}>save</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutation of Array-producer state: useState(Array(5).fill(0))", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Board() {
        const [cells, setCells] = useState(Array(5).fill(0));
        const reset = () => { cells.fill(1); };
        return <button onClick={reset}>{cells.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutation of Array.from-producer state", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Board() {
        const [rows, setRows] = useState(Array.from({ length: 3 }, () => 0));
        const add = () => { rows.push(0); };
        return <button onClick={add}>{rows.length}</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutation of structuredClone-producer state", () => {
    const result = runRule(
      noDirectStateMutation,
      `const DEFAULT_FILTERS = { active: true };
      function Filters() {
        const [filters, setFilters] = useState(structuredClone(DEFAULT_FILTERS));
        const toggle = () => { filters.active = false; };
        return <button onClick={toggle}>toggle</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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

  it("stays silent on a lazy initializer returning an opaque instance", () => {
    const result = runRule(
      noDirectStateMutation,
      `function Editor() {
        const [engine, setEngine] = useState(() => createEditorEngine());
        const configure = () => { engine.options = { readOnly: true }; };
        return <button onClick={configure}>configure</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
