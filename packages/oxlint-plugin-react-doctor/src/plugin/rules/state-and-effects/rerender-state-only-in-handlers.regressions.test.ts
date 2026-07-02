import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("rerender-state-only-in-handlers — regressions", () => {
  it("stays silent when state drives a side-effect-only effect through a one-hop derived local", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Widget() {
        const [page, setPage] = useState(1);
        const offset = page * 10;
        useEffect(() => { fetchItems(offset); }, [offset]);
        return <button onClick={() => setPage((p) => p + 1)}>Next</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when state is read during render by a hook call argument", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Chart() {
        const [scrollY, setScrollY] = useState(0);
        const onScroll = () => setScrollY(window.scrollY);
        useChartEngine(scrollY);
        return <div onScroll={onScroll} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the adjust-state-during-render prev-value guard", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const RadioGroup = ({ value }) => {
        const [selectedValue, setSelectedValue] = useState(null);
        const [prevValue, setPrevValue] = useState(value);
        if (prevValue !== value) {
          setPrevValue(value);
          setSelectedValue(value ?? null);
        }
        return <div role="radiogroup">{selectedValue}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags write-only state with no effect dependency", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function App() {
        const [logged, setLogged] = useState(false);
        const onClick = () => setLogged(true);
        return <button onClick={onClick}>go</button>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("logged");
  });

  // bem-yandex/ui drawer content: `closing` is
  // never rendered — the effect that lists it in deps self-resets it, so the
  // dep mention must not exempt it.
  it("flags handler-set state whose only effect self-resets it (bem-yandex drawer)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const DrawerContent = ({ visible, springValue, onClose, onCloseEnd }) => {
        const [closing, setClosing] = useState(false);
        useEffect(() => {
          if (closing && springValue === 0) {
            onCloseEnd();
            setClosing(false);
          }
        }, [closing, springValue, onCloseEnd]);
        const handleClose = useCallback(() => {
          setClosing(true);
          onClose();
        }, [onClose]);
        return <div onClick={handleClose}>{visible ? springValue : null}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("closing");
  });

  // jumpinjackie/mapguide-react-layout task pane:
  // `invalidated` only feeds an effect that rewrites it from props — echoing
  // it in that effect's deps must not exempt it.
  it("flags never-rendered state rewritten by its own dep-listing effect (mapguide task pane)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function TaskPane({ currentUrl, mapName, locale, onUrlLoaded }) {
        const [invalidated, setInvalidated] = React.useState(false);
        const [frameContentLoaded, setFrameContentLoaded] = React.useState(false);
        const handleFrameLoaded = React.useCallback((e) => {
          setFrameContentLoaded(true);
          onUrlLoaded(e.currentTarget.contentWindow.location.href);
        }, [onUrlLoaded]);
        React.useEffect(() => {
          if (!invalidated && currentUrl && currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(true);
          } else if (invalidated && currentUrl && !currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(false);
          }
        }, [currentUrl, mapName, invalidated]);
        return (
          <div>
            <iframe name="taskPaneFrame" onLoad={handleFrameLoaded} />
            {frameContentLoaded === false ? <TaskFrameLoadingOverlay locale={locale} /> : null}
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("invalidated");
  });

  // sofn-xyz/mailing settings: `apiKeys` only
  // feeds a derived-state chain effect (`setApiKeyRows`) — the dep mention is
  // chain plumbing, not reactive consumption.
  it("flags state consumed only by a derived-state chain effect (sofn settings)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings(props) {
        const [apiKeys, setApiKeys] = useState(props.apiKeys);
        const [apiKeyRows, setApiKeyRows] = useState([]);
        const createApiKey = useCallback(async () => {
          const response = await fetch("/api/apiKeys", { method: "POST" });
          const json = await response.json();
          setApiKeys(apiKeys.concat(json.apiKey));
        }, [apiKeys]);
        useEffect(() => {
          setApiKeyRows(
            apiKeys.map((apiKey) => [apiKey.id, JSON.stringify(apiKey.active)]),
          );
        }, [apiKeys]);
        return (
          <div>
            <OutlineButton onClick={createApiKey} text="New API Key" />
            <Table rows={apiKeyRows} />
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("apiKeys");
  });

  // wangeditor-next editor: the
  // creation effect that lists `editor` in deps also writes it, so the
  // side-effect-only effects listing it too must not rescue it.
  it("flags never-rendered state when any dep-listing effect writes it (wangeditor editor)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EditorComponent({ value, defaultConfig, onChange, mode }) {
        const ref = useRef(null);
        const latestHtmlRef = useRef(null);
        const [editor, setEditor] = useState(null);
        const handleDestroyed = useCallback(() => {
          setEditor(null);
        }, []);
        useEffect(() => {
          if (editor == null) return;
          editor.__react_on_change = (e) => {
            latestHtmlRef.current = e.getHtml();
            if (onChange) onChange(e);
          };
          return () => {
            editor.__react_on_change = undefined;
          };
        }, [editor, defaultConfig, onChange]);
        useEffect(() => {
          if (editor == null) return;
          if (value === latestHtmlRef.current) return;
          editor.setHtml(value);
          latestHtmlRef.current = editor.getHtml();
        }, [editor, value]);
        useEffect(() => {
          if (ref.current == null) return;
          if (editor != null) return;
          const newEditor = createEditor({
            selector: ref.current,
            config: { ...defaultConfig, onDestroyed: handleDestroyed },
            mode,
          });
          latestHtmlRef.current = newEditor.getHtml();
          setEditor(newEditor);
        }, [editor, defaultConfig, handleDestroyed, mode, value]);
        return <div ref={ref} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("editor");
  });

  it("stays silent when state is a pure effect re-run trigger the effect never reads (ant-design AffixTabs)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const AffixTabs = () => {
        const idsRef = React.useRef([]);
        const [loaded, setLoaded] = React.useState(false);
        React.useEffect(() => {
          idsRef.current = Array.from(document.querySelectorAll('h2[id]')).map(({ id }) => id);
          setLoaded(true);
        }, []);
        React.useEffect(() => {
          const hashId = decodeURIComponent((location.hash || '').slice(1));
          if (hashId) scrollToId(hashId);
        }, [loaded]);
        return <div>tabs</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the adjust-state-during-render prev-value guard (brainly RadioGroup)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function RadioGroup({ value }) {
        const [prevValue, setPrevValue] = useState(value);
        const [internalValue, setInternalValue] = useState(value);
        if (value !== prevValue) {
          setPrevValue(value);
          setInternalValue(value);
        }
        const onChange = (next) => setInternalValue(next);
        return <div onClick={() => onChange(value)}>{internalValue}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

// Must-detect anchors: write-only state echoed in an effect dep
// array AND read by the effect body. The dep entry is exhaustive-deps hygiene
// for the body read, not proof the value ever reaches the screen, so these
// must fire.
describe("rerender-state-only-in-handlers — must-detect anchors (state read by an effect, never rendered)", () => {
  it("flags `closing` set in a handler and consumed only by an effect (bem-yandex DrawerContent)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `const DrawerContent = ({ springValue, onCloseEnd, onClose, children }) => {
        const contentRef = useRef(null);
        const [closing, setClosing] = useState(false);
        useEffect(() => {
          if (closing && springValue === 0) {
            onCloseEnd();
            setClosing(false);
          }
        }, [closing, springValue, onCloseEnd]);
        const _onClose = useCallback(() => {
          setClosing(true);
          onClose();
        }, [onClose]);
        return <div ref={contentRef} onClick={_onClose}>{children}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("closing");
  });

  it("flags `emojiData` set by one effect and read only by another (frimousse emoji-picker)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EmojiPickerDataHandler({ emojiVersion, emojibaseUrl }) {
        const [emojiData, setEmojiData] = useState(undefined);
        const store = useEmojiPickerStore();
        const locale = useSelectorKey(store, "locale");
        const columns = useSelectorKey(store, "columns");
        const skinTone = useSelectorKey(store, "skinTone");
        const search = useSelectorKey(store, "search");
        useEffect(() => {
          const controller = new AbortController();
          getEmojiData({ locale, emojiVersion, emojibaseUrl, signal: controller.signal })
            .then((data) => setEmojiData(data))
            .catch(() => {});
          return () => controller.abort();
        }, [emojiVersion, emojibaseUrl, locale]);
        useEffect(() => {
          if (!emojiData) return;
          return requestIdleCallback(() => {
            store.get().onDataChange(getEmojiPickerData(emojiData, columns, skinTone, search));
          }, { timeout: 100 });
        }, [emojiData, columns, skinTone, search]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("emojiData");
  });

  it("flags `editor` state only read inside effects (wangeditor Editor)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function EditorComponent({ defaultConfig, onChange, value }) {
        const [editor, setEditor] = useState(null);
        const ref = useRef(null);
        useEffect(() => {
          if (editor != null) return;
          const newEditor = createEditor({ selector: ref.current, config: { ...defaultConfig, onChange } });
          setEditor(newEditor);
        }, [editor, defaultConfig, onChange]);
        useEffect(() => {
          if (editor == null) return;
          editor.setHtml(value);
        }, [editor, value]);
        return <div ref={ref} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("editor");
  });

  it("flags `invalidated` read only in an effect + its deps (mapguide TaskPane)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `export const TaskPane = ({ currentUrl, mapName, locale, onUrlLoaded }) => {
        const [invalidated, setInvalidated] = React.useState(false);
        const [frameContentLoaded, setFrameContentLoaded] = React.useState(false);
        const handleFrameLoaded = React.useCallback((e) => {
          setFrameContentLoaded(true);
          onUrlLoaded(e.currentTarget.contentWindow.location.href);
        }, [onUrlLoaded]);
        React.useEffect(() => {
          if (!invalidated && currentUrl && currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(true);
          } else if (invalidated && currentUrl && !currentUrlDoesNotMatchMapName(currentUrl, mapName)) {
            setInvalidated(false);
          }
        }, [currentUrl, mapName, invalidated]);
        return (
          <div>
            {(() => {
              const components = [<iframe key="f" onLoad={handleFrameLoaded} />];
              if (frameContentLoaded === false) {
                components.push(<span key="o">{locale}</span>);
              }
              return components;
            })()}
          </div>
        );
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("invalidated");
  });

  it("flags `apiKeys` read only in a handler + an effect (sofn-xyz mailing settings)", () => {
    const result = runRule(
      rerenderStateOnlyInHandlers,
      `function Settings(props) {
        const [apiKeys, setApiKeys] = useState(props.apiKeys);
        const [apiKeyRows, setApiKeyRows] = useState([]);
        const createApiKey = useCallback(async () => {
          const response = await fetch("/api/apiKeys", { method: "POST" });
          const json = await response.json();
          setApiKeys(apiKeys.concat(json.apiKey));
        }, [apiKeys]);
        useEffect(() => {
          setApiKeyRows(apiKeys.map((apiKey) => [apiKey.id, JSON.stringify(apiKey.active)]));
        }, [apiKeys]);
        return <div onClick={createApiKey}>{apiKeyRows.length}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("apiKeys");
  });
});
