import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFloatingThenInJsxHandler } from "./no-floating-then-in-jsx-handler.js";

describe("no-floating-then-in-jsx-handler", () => {
  it("does not flag the Promise.resolve().then(...) microtask-scheduling idiom", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const x = <button onMouseLeave={() => {
        Promise.resolve().then(() => { ref.current.dataset.suppress = "false"; });
      }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a concise-arrow floating then", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => doThing().then(handleResult)} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a block-body floating then", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <form onSubmit={() => { saveForm().then(() => setOpen(false)); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a member-call then chain", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <input onChange={() => api.update(x).then(refetch)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a logout().then() navigation handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <a onClick={() => logout().then(() => (window.location.href = '/'))} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an if-guarded floating then (confirm-before-delete idiom)", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { if (window.confirm('Delete?')) removeItem().then(refetch); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a &&-guarded concise floating then", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => isDirty && save().then(refetch)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags both branches of a ternary with floating thens", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => (isNew ? create().then(done) : update().then(done))} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a .then chain whose only settlement handler is .finally — .finally re-throws rejections", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { fetchData().then(setData).finally(() => setLoading(false)); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an async handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={async () => { await save(); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an explicit void fire-and-forget", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => void save().then(refetch)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain with a .catch", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(refetch).catch(reportError)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a two-argument then with onRejected", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(onOk, onErr)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a chain whose rejection is handled by a mid-chain .then(null, onErr)", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(null, onErr).then(onOk)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare .finally with no .then in the chain", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().finally(done)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .catch followed by a trailing .finally", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => save().then(r).catch(reportError).finally(done)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a promise chain returned from a block handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { return save().then(refetch); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a handler with no .then token", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => setOpen(true)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an identifier handler reference", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={handleClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then inside a nested callback within the handler", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { items.forEach((x) => save(x).then(done)); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-handler prop", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <Comp render={() => load().then(show)} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the chain root is a same-file helper whose fetch chain ends in .catch (NextChat shape)", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const upload = (code) => {
         if (cachedId) return Promise.resolve({ id: cachedId });
         return fetch("/api/upload", { method: "POST", body: code })
           .then((res) => res.json())
           .catch((e) => showToast(String(e)));
       };
       const Artifacts = ({ code }) => (
         <button onClick={() => upload(code).then((res) => setShareUrl(res.id))}>Share</button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the chain root is a same-file async helper with fully try/caught awaits", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const copyToClipboard = async (text) => {
         try {
           await navigator.clipboard.writeText(text);
           return true;
         } catch (error) {
           console.error(error);
           return false;
         }
       };
       const Table = ({ value }) => (
         <button onClick={() => copyToClipboard(value).then((ok) => ok && toastSuccess())}>Copy</button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a synchronously-resolved new Promise sequencing wrapper", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const Editor = ({ commit }) => (
         <button
           onClick={() =>
             new Promise((resolve) => {
               commit();
               resolve(true);
             }).then(() => focusNextRow())
           }
         >
           Save
         </button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the same-file helper's awaits are not all try/caught", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const save = async (draft) => {
         const validated = await validate(draft);
         try {
           return await persist(validated);
         } catch (error) {
           return null;
         }
       };
       const Form = ({ draft }) => (
         <button onClick={() => save(draft).then((res) => setSaved(res))}>Save</button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a new Promise wrapper whose executor declares reject", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const Uploader = ({ file }) => (
         <button
           onClick={() =>
             new Promise((resolve, reject) => {
               reader.onerror = reject;
               reader.readAsText(file);
             }).then((text) => setContent(text))
           }
         >
           Read
         </button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Promise.allSettled(...).then(...) — allSettled never rejects", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { Promise.allSettled(files.map((file) => deleteFile(file.id))).then(setResults); }}>Delete all</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Promise.resolve().then(cb) microtask deferral for focus", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <MenuItem onSelect={() => { setOpen(false); Promise.resolve().then(() => triggerRef.current?.focus()); }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: TanStack Query refetch() — documented to never reject", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => refetch().then(({ data }) => setSelected(data?.rows[0] ?? null))}>Reload</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Concise arrow returns the chain to an in-file consumer that awaits it in try/catch", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const ConfirmDialog = ({ onConfirm }) => {
  const [failed, setFailed] = useState(false);
  const handleOk = async () => {
    try {
      await onConfirm();
    } catch {
      setFailed(true);
    }
  };
  return <button onClick={handleOk}>{failed ? "Retry" : "OK"}</button>;
};
const DeleteFlow = ({ removeItem, onRemoved }) => (
  <ConfirmDialog onConfirm={() => removeItem().then(onRemoved)} />
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: In-file helper already swallows rejection with .catch — handler chains .then on it", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const loadPreview = (url) =>
  fetch(url)
    .then((res) => res.json())
    .catch(() => null);
const PreviewButton = ({ url, setPreview }) => (
  <button onMouseEnter={() => { loadPreview(url).then(setPreview); }}>Preview</button>
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Resolve-only new Promise bridge — image preloader resolves on both load and error", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const preloadImage = (src) =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = src;
  });
const Thumb = ({ nextSrc, setReady }) => (
  <img onMouseEnter={() => { preloadImage(nextSrc).then(setReady); }} alt="" />
);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: navigator.serviceWorker.ready — spec-guaranteed to never reject", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const el = <button onClick={() => { navigator.serviceWorker.ready.then(() => setPwaReady(true)); }}>Enable offline</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a floating then on a DOM handler over a rejectable call", () => {
    const result = runRule(
      noFloatingThenInJsxHandler,
      `const Save = ({ save }) => (
         <button onClick={() => save().then((res) => setSaved(res))}>Save</button>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
