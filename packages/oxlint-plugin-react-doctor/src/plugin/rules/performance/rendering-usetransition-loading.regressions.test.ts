import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingUsetransitionLoading } from "./rendering-usetransition-loading.js";

describe("performance/rendering-usetransition-loading — regressions", () => {
  it("stays silent when the loading flag tracks a promise chain", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const load = () => { setIsLoading(true); loadData().then(() => setIsLoading(false)); }; return <button onClick={load}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a synchronous loading-flag toggle", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const toggle = () => { setIsLoading(true); }; return <button onClick={toggle}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes('"isLoading"')),
    ).toBe(true);
  });

  it("stays silent when FileReader success and error callbacks finish the loading state", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.onload = () => { setIsLoading(false); setText(reader.result); }; reader.onerror = () => { setIsLoading(false); setError(reader.error); }; reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the Tracecat FileReader shape with useCallback completion helpers", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `import { useCallback, useState } from "react"; function Upload() { const [isLoading, setIsLoading] = useState(false); const clearLoadingStatus = useCallback(() => { setIsLoading(false); setFilename(null); }, []); const failRead = useCallback(() => { setError("read failed"); clearLoadingStatus(); }, [clearLoadingStatus]); const handleFile = useCallback((file) => { setIsLoading(true); let reader; try { reader = new FileReader(); } catch { failRead(); return; } reader.onload = () => { setText(reader.result); clearLoadingStatus(); }; reader.onerror = () => { failRead(); }; reader.readAsText(file); }, [clearLoadingStatus, failRead]); return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags FileReader loading without an error completion", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.onload = () => setIsLoading(false); reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags FileReader loading without a success completion", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.onerror = () => setIsLoading(false); reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags callback properties on an unrelated local object", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = createReader(); reader.onload = () => setIsLoading(false); reader.onerror = () => setIsLoading(false); reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a locally shadowed FileReader constructor", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload({ FileReader }) { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.onload = () => setIsLoading(false); reader.onerror = () => setIsLoading(false); reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a FileReader callback overwritten before reading starts", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.onload = () => setIsLoading(false); reader.onerror = () => setIsLoading(false); reader.onerror = reportError; reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags FileReader callbacks installed after reading starts", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.readAsText(file); reader.onload = () => setIsLoading(false); reader.onerror = () => setIsLoading(false); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags FileReader callbacks that clear a different loading state", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Upload() { const [isLoading, setIsLoading] = useState(false); const [isPreviewLoading, setIsPreviewLoading] = useState(false); const handleFile = (file) => { setIsLoading(true); const reader = new FileReader(); reader.onload = () => setIsPreviewLoading(false); reader.onerror = () => setIsPreviewLoading(false); reader.readAsText(file); }; return <button onClick={() => handleFile(file)}>{isLoading ? "Reading" : "Upload"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes('"isLoading"')),
    ).toBe(true);
  });

  // FN-critical anchor (algolia/react-instantsearch useAnswers):
  // the mined bug clears the flag only INDIRECTLY — the .then handler calls a
  // debounced wrapper that in turn calls the setter. The promise-chain guard
  // deliberately inspects only inline .then/.catch/.finally arguments for DIRECT
  // setter calls; following handler indirection would silence this report.
  it("still flags the mined useAnswers shape: setter cleared via a debounce-indirected .then handler", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `
function useAnswers({ query }) {
  const [isLoading, setIsLoading] = useState(false);
  const [answers, setAnswers] = useState([]);
  const setDebouncedResult = useMemo(
    () =>
      debounce((result) => {
        setIsLoading(false);
        setAnswers(result.hits);
      }, 200),
    [],
  );
  useEffect(() => {
    setIsLoading(true);
    findAnswers(query).then((result) => {
      setDebouncedResult(result);
    });
  }, [query, setDebouncedResult]);
  return { isLoading, answers };
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a setter cleared via a named .then handler (handler reference, not inline)", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); const handleResult = (result) => { setIsLoading(false); }; const load = () => { setIsLoading(true); loadData().then(handleResult); }; return <button onClick={load}>{isLoading ? "..." : "go"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // FP anchor (internxt WorkspaceSelectorContainer): the setter is handed
  // to a child as a prop — the toggling happens off-screen, so the rule
  // can't claim the flag guards a sync update.
  it("stays silent when the setter escapes as a JSX prop", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function C() { const [isLoading, setIsLoading] = useState(false); return <Dialog isLoading={isLoading} setIsLoading={setIsLoading} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (internxt useGuestSignupState): a form-state hook returns the
  // setter for its consumer's network submission.
  it("stays silent when the setter is returned from a custom hook", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function useSignupState() { const [isLoading, setIsLoading] = useState(false); return { isLoading, setIsLoading }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (kurozenzen Search): setLoading(true) precedes a redux thunk
  // dispatch — the flag tracks the store's async fetch lifecycle.
  it("stays silent when the setter is called alongside a redux dispatch", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Search() { const [isLoading, setLoading] = useState(false); const dispatch = useDispatch(); const loadMore = useCallback(() => { setLoading(true); dispatch(getMoreResults()); }, [dispatch]); return <List loadMore={loadMore} isLoading={isLoading} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (internxt ShareWithTeamDialog): a sync starter toggles the
  // flag and fires local async fetch helpers.
  it("stays silent when the setter's function calls a local async helper", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function ShareDialog() { const [isLoading, setIsLoading] = useState(false); const getTeams = async () => { const teams = await service.getTeams(); setTeamsState(teams); }; const fetchTeams = () => { setIsLoading(true); getTeams(); }; return <button onClick={fetchTeams}>{isLoading ? "..." : "share"}</button>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (nexu-io DesignBrowserPanel): the flag mirrors a webview's
  // did-start/did-stop loading events.
  it("stays silent when the setter is toggled from addEventListener handlers", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function Panel({ node }) { const [isLoading, setIsLoading] = useState(false); useEffect(() => { const onStart = () => { setIsLoading(true); }; const onStop = () => { setIsLoading(false); }; node.addEventListener("did-start-loading", onStart); node.addEventListener("did-stop-loading", onStop); return () => { node.removeEventListener("did-start-loading", onStart); node.removeEventListener("did-stop-loading", onStop); }; }, [node]); return <div>{isLoading ? "..." : "ready"}</div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (audius ImageField): the flag is cleared by the image's
  // onLoad — genuinely asynchronous media loading.
  it("stays silent when the setter is cleared in a resource onLoad attribute", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function ImageField({ url }) { const [isLoading, setIsLoading] = useState(false); const handlePress = () => { pickImage((image) => { setValue(image); setIsLoading(true); }); }; return <img src={url} onLoad={() => setIsLoading(false)} onClick={handlePress} />; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // FP anchor (cloudscape wizard demo page): the flag is only ever flipped
  // by bare inline JSX handlers — it IS the demoed feature, there is no
  // update to wrap in a transition.
  it("stays silent when the flag is only flipped by bare inline JSX handlers", () => {
    const result = runRule(
      renderingUsetransitionLoading,
      `function WizardPage() { const [isLoading, setIsLoading] = useState(false); return <div><button onClick={() => setIsLoading(true)}>Set loading</button><Wizard isLoadingNextStep={isLoading} /></div>; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
