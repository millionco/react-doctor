import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedUseState } from "./no-derived-use-state.js";

describe("no-derived-useState — regressions", () => {
  it("stays silent on a draft buffer re-seeded from the prop inside a nested handler", () => {
    const result = runRule(
      noDerivedUseState,
      `function TitleEditor(props) {
        const [title, setTitle] = useState(props.title);
        const onFocus = () => setTitle(props.title);
        return <input value={title} onFocus={onFocus} onChange={(e) => setTitle(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a destructured-prop draft buffer re-seeded in a nested handler", () => {
    const result = runRule(
      noDerivedUseState,
      `function TitleEditor({ title }) {
        const [draftTitle, setDraftTitle] = useState(title);
        const beginEdit = () => setDraftTitle(title);
        return <input value={draftTitle} onFocus={beginEdit} onChange={(e) => setDraftTitle(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a draft buffer re-seeded in a useCallback-wrapped handler", () => {
    const result = runRule(
      noDerivedUseState,
      `function TitleEditor({ title }) {
        const [draftTitle, setDraftTitle] = useState(title);
        const beginEdit = useCallback(() => setDraftTitle(title), [title]);
        return <input value={draftTitle} onFocus={beginEdit} onChange={(e) => setDraftTitle(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on the adjust-during-render pattern with a prop-derived argument", () => {
    const result = runRule(
      noDerivedUseState,
      `function RadioGroup({ value }) {
        const [prevValue, setPrevValue] = useState(value);
        if (prevValue !== value) {
          setPrevValue(value);
        }
        return <div>{prevValue}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // cloudscape split-panel provider: the effect overwrites the seed with a
  // computed value whenever the deps change — the state never goes stale.
  it("stays silent when an effect re-syncs the state with a computed value", () => {
    const result = runRule(
      noDerivedUseState,
      `function SplitPanelProvider({ size, getMaxHeight }) {
        const [maxHeight, setMaxHeight] = useState(size);
        useEffect(() => {
          setMaxHeight(getMaxHeight());
        }, [size, getMaxHeight]);
        return <div style={{ maxHeight }} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // react-cosmos StringValueInput: the effect re-syncs conditionally (only
  // while unfocused) — the documented cursor-jump fix, not a stale copy.
  it("stays silent when an effect re-syncs the prop behind a guard", () => {
    const result = runRule(
      noDerivedUseState,
      `function StringValueInput({ data, focused }) {
        const [localData, setLocalData] = useState(data);
        useEffect(() => {
          if (!focused) setLocalData(data);
        }, [focused, data]);
        return <textarea value={localData} onChange={(e) => setLocalData(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // debounce / animation-lag shapes: the setter runs inside a timeout
  // callback within the effect, so the state deliberately lags the prop.
  it("stays silent when an effect re-syncs the prop inside a timeout (debounce)", () => {
    const result = runRule(
      noDerivedUseState,
      `function DebouncedUrl({ url }) {
        const [debouncedUrl, setDebouncedUrl] = useState(url);
        useEffect(() => {
          const timeout = setTimeout(() => setDebouncedUrl(url), 300);
          return () => clearTimeout(timeout);
        }, [url]);
        return <iframe src={debouncedUrl} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // brainly Dialog: a render-phase adjust guarded by the state itself keeps
  // the value converging even though the assigned value is a constant.
  it("stays silent on a render adjust guarded by the state (mount latch)", () => {
    const result = runRule(
      noDerivedUseState,
      `function Dialog({ open }) {
        const [mounted, setMounted] = useState(open);
        if (open && !mounted) {
          setMounted(true);
        }
        const onExited = useCallback(() => setMounted(false), []);
        return mounted ? <div onTransitionEnd={onExited} /> : null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // hyperdx DashboardContainer: the rename draft is re-seeded in a click
  // handler from a component-scope local derived from the prop.
  it("stays silent when a handler re-seeds the draft from a component-scope local", () => {
    const result = runRule(
      noDerivedUseState,
      `function DashboardContainer({ container }) {
        const headerTitle = container.title || 'Untitled';
        const [groupRenameValue, setGroupRenameValue] = useState(container.title);
        const [isRenaming, setIsRenaming] = useState(false);
        return (
          <div
            onClick={() => {
              setGroupRenameValue(headerTitle);
              setIsRenaming(true);
            }}
          >
            {isRenaming ? <input value={groupRenameValue} onChange={(e) => setGroupRenameValue(e.target.value)} /> : headerTitle}
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // webstudio Loading: a periodic hook drives the state with a functional
  // updater — machine-driven progress, not a copy of the prop.
  it("stays silent when a periodic hook evolves the state with a functional updater", () => {
    const result = runRule(
      noDerivedUseState,
      `function Loading({ state }) {
        const [fakeProgress, setFakeProgress] = useState(state.progress);
        useInterval(() => {
          setFakeProgress((previous) => Math.max(previous + 1, state.progress));
        }, 100);
        return <progress value={fakeProgress} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // dialog-session drafts: a component that can dismiss itself mounts fresh
  // per open, so the copied prop is intentional draft state.
  it("stays silent on a draft copy inside a self-dismissing dialog component", () => {
    const result = runRule(
      noDerivedUseState,
      `function RenameDialog({ currentName, onConfirm, onCancel }) {
        const [name, setName] = useState(currentName);
        return (
          <form onSubmit={() => onConfirm(name)}>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <button type="button" onClick={onCancel}>Cancel</button>
          </form>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // snapshot semantics: no setter destructured, or a name that announces
  // history ("previousX") — the staleness is the feature.
  it("stays silent on a setterless first-render snapshot", () => {
    const result = runRule(
      noDerivedUseState,
      `function Wizard({ activeStep }) {
        const [initialStep] = useState(activeStep);
        return <span>{activeStep - initialStep}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on snapshot-named state (previous / preserved / debounced)", () => {
    const result = runRule(
      noDerivedUseState,
      `function TabHeaderBar({ activeTabId }) {
        const [previousActiveTabId, setPreviousActiveTabId] = useState(activeTabId);
        useEffect(() => {
          return () => setPreviousActiveTabId(activeTabId);
        }, [activeTabId]);
        return <div data-previous={previousActiveTabId} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // initial-only naming extensions: `initial` / `initiallyOpen` / `autoFocus`
  // as identifiers, and initial-named ROOTS of member chains
  // (`initialShipping.city`).
  it("stays silent on initial-only seed names and initial-named member roots", () => {
    const result = runRule(
      noDerivedUseState,
      `function AddressForm({ initialShipping, autoFocus, initiallyOpen }) {
        const [city, setCity] = useState(initialShipping.city);
        const [focused, setFocused] = useState(autoFocus);
        const [open, setOpen] = useState(initiallyOpen);
        return (
          <input
            value={city}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setCity(e.target.value)}
            onClick={() => setOpen(!open)}
          />
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a plain stale prop copy with no re-seed", () => {
    const result = runRule(
      noDerivedUseState,
      `function Profile({ name }) {
        const [draftName, setDraftName] = useState(name);
        return <input value={draftName} onChange={(e) => setDraftName(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // docs-validation FP wave: the doc scopes the rule to direct Identifier /
  // member-expression initializers — a `||` / `??` defaulting expression is
  // out of scope and marks the intentional "default the user then edits"
  // seed (`useState(value || null)`, `useState(x ?? new Date())`).
  it("stays silent on a prop copied through || / ?? defaulting", () => {
    const result = runRule(
      noDerivedUseState,
      `function Select({ selectedItem, type }) {
        const [selected, setSelected] = useState(selectedItem || '');
        const [chartType, setChartType] = useState(type ?? 'line');
        return <div onClick={() => { setSelected(''); setChartType(''); }}>{selected}{chartType}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a coalescing seed for user-navigable state", () => {
    const result = runRule(
      noDerivedUseState,
      `function DateRangePicker({ value }) {
        const [month, setMonth] = useState(value?.from ?? new Date());
        return <DayPicker month={month} onMonthChange={setMonth} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a prop member copied through optional chaining and computed access", () => {
    const result = runRule(
      noDerivedUseState,
      `function Filters({ cfg, data }) {
        const [low, setLow] = useState(cfg?.low);
        const [activeTab, setActiveTab] = useState(data[0]?.value);
        return <div onClick={() => { setLow(0); setActiveTab(0); }}>{low}{activeTab}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a prop copied through negation or a template-literal cast", () => {
    const result = runRule(
      noDerivedUseState,
      `function Panel(props) {
        const [uploadDisabled, setUploadDisabled] = useState(!props.uploadPermission);
        const [windowText, setWindowText] = useState(\`\${props.window}\`);
        return <div onClick={() => { setUploadDisabled(false); setWindowText(''); }}>{windowText}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  // docs-validation FP wave: any sync effect that re-copies the prop keeps
  // the state fresh, so the "copies it once, users see a stale value"
  // message is untrue. The unconditional mirror shape is
  // `no-mirror-prop-effect`'s single actionable diagnostic.
  it("stays silent when a sync effect re-copies the prop (mirror owned by no-mirror-prop-effect)", () => {
    const result = runRule(
      noDerivedUseState,
      `function Mirror({ value }) {
        const [draft, setDraft] = useState(value);
        useEffect(() => { setDraft(value); }, [value]);
        return <span>{draft}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a mirror re-seeded through a custom effect wrapper hook", () => {
    const result = runRule(
      noDerivedUseState,
      `function Mirror({ value }) {
        const [current, setCurrent] = useState(value);
        useUpdateEffect(() => {
          setCurrent(value);
        }, [value]);
        return <span>{current}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a mirror re-seeded inside a useMemo callback", () => {
    const result = runRule(
      noDerivedUseState,
      `function Mirror({ value }) {
        const [current, setCurrent] = useState(value);
        const derived = useMemo(() => {
          setCurrent(value);
          return value.length;
        }, [value]);
        return <span>{derived}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // docs-validation FP wave: a destructured prop WITH a default is optional
  // config — seeding user-editable local state from it is the intentional
  // uncontrolled "default value the user then edits" pattern.
  it("stays silent on a defaulted destructured prop seeding editable state", () => {
    const result = runRule(
      noDerivedUseState,
      `function Highlighter({ language = 'markdown' }) {
        const [lang, setLang] = useState(language);
        return <Toolbar language={lang} setLanguage={setLang} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // docs-validation FP wave: the draft is committed back to the parent
  // through a prop callback — the parent stays the source of truth and the
  // local copy is an intentional working buffer.
  it("stays silent on a draft committed to the parent via a prop callback", () => {
    const result = runRule(
      noDerivedUseState,
      `function TokenPicker({ selectedTokenAddress, onChange }) {
        const [selectedAddress, setSelectedAddress] = useState(selectedTokenAddress);
        const handleSubmit = useCallback(() => {
          if (selectedAddress) onChange(selectedAddress);
        }, [onChange, selectedAddress]);
        return <Picker value={selectedAddress} onSelect={setSelectedAddress} onSubmit={handleSubmit} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the committed draft flows through a call chain", () => {
    const result = runRule(
      noDerivedUseState,
      `function WelcomeStep({ tokenFromUrl, onSubmit }) {
        const [token, setToken] = useState(tokenFromUrl);
        async function handle(e) {
          e.preventDefault();
          await onSubmit(token.trim());
        }
        return <form onSubmit={handle}><input value={token} onChange={(e) => setToken(e.target.value)} /></form>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // docs-validation FP wave: getServerSideProps page props are fixed for
  // the page instance (navigation remounts), so useState(props.x) is the
  // canonical initialize-from-server-props capture.
  it("stays silent on server-props capture in a Next.js data-fetching page", () => {
    const result = runRule(
      noDerivedUseState,
      `export const getServerSideProps = withSessionSsr(async () => ({ props: {} }));
      function Settings(props) {
        const [apiKeys, setApiKeys] = useState(props.apiKeys);
        return <button onClick={() => setApiKeys(apiKeys.concat('new'))}>{apiKeys.length}</button>;
      }
      export default Settings;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // docs-validation FP wave: a prop with "Initial" mid-name announces the
  // one-shot seed contract just like an initial- prefix does.
  it("stays silent on a mid-name Initial prop seed", () => {
    const result = runRule(
      noDerivedUseState,
      `function EntryShell({ integrationInitialTab }) {
        const [integrationTab, setIntegrationTab] = useState(integrationInitialTab);
        return <Tabs value={integrationTab} onChange={setIntegrationTab} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a stale copy committed nowhere (local-only callee)", () => {
    const result = runRule(
      noDerivedUseState,
      `function Profile({ name }) {
        const [draftName, setDraftName] = useState(name);
        const log = (value) => console.log(value);
        return <input value={draftName} onFocus={() => log(draftName)} onChange={(e) => setDraftName(e.target.value)} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the only render-phase setter call resets to an unrelated constant", () => {
    const result = runRule(
      noDerivedUseState,
      `function List({ items, page }) {
        const [visibleItems, setVisibleItems] = useState(items);
        if (page < 1) {
          setVisibleItems([]);
        }
        return <ul>{visibleItems.length}</ul>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
