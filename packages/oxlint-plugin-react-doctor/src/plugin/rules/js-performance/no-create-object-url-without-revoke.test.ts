import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateObjectUrlWithoutRevoke } from "./no-create-object-url-without-revoke.js";

describe("no-create-object-url-without-revoke", () => {
  it("flags an object URL assigned to an anchor href with no revoke", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const download = (blob) => {
         a.href = URL.createObjectURL(blob);
         a.download = 'README.md';
         a.click();
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded object URL stored into a variable and state", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImage = (data) => {
         const imageObjectUrl = data && URL.createObjectURL(data);
         setImgObjectUrl(imageObjectUrl);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a guarded object URL assigned to a pre-declared variable", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImage = (data) => {
         let imageObjectUrl;
         imageObjectUrl = data && URL.createObjectURL(data);
         setImgObjectUrl(imageObjectUrl);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an if-guarded object URL assigned to a pre-declared variable", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImage = (data) => {
         let imageObjectUrl;
         if (data) imageObjectUrl = URL.createObjectURL(data);
         setImgObjectUrl(imageObjectUrl);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags if-scoped object URL declarations that escape", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImage = (data, fallback) => {
         if (data) {
           const imageObjectUrl = URL.createObjectURL(data);
           setImgObjectUrl(imageObjectUrl);
         } else {
           const fallbackObjectUrl = URL.createObjectURL(fallback);
           image.src = fallbackObjectUrl;
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes guaranteed cleanup after if-scoped object URL declarations", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImages = (firstBlob, secondBlob) => {
         if (firstBlob) {
           const firstUrl = URL.createObjectURL(firstBlob);
           setFirstUrl(firstUrl);
           URL.revokeObjectURL(firstUrl);
         }
         if (secondBlob) {
           const secondUrl = URL.createObjectURL(secondBlob);
           setSecondUrl(secondUrl);
           if (secondUrl) URL.revokeObjectURL(secondUrl);
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires if-scoped cleanup to follow creation and run on every path", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const useImages = (firstBlob, secondBlob, shouldRevoke) => {
         if (firstBlob) {
           let firstUrl;
           URL.revokeObjectURL(firstUrl);
           firstUrl = URL.createObjectURL(firstBlob);
           setFirstUrl(firstUrl);
         }
         if (secondBlob) {
           const secondUrl = URL.createObjectURL(secondBlob);
           setSecondUrl(secondUrl);
           if (shouldRevoke) URL.revokeObjectURL(secondUrl);
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).toContain("this produced URL is not provably revoked");
      expect(diagnostic.message).toContain("pass that same value to `URL.revokeObjectURL`");
      expect(diagnostic.message).not.toContain("never calls");
    }
  });

  it("recognizes cleanup for an if-guarded pre-declared assignment", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const makeImageUrl = (data) => URL.createObjectURL(data);
       const useImage = (data) => {
         let imageObjectUrl;
         if (data) imageObjectUrl = makeImageUrl(data);
         setImgObjectUrl(imageObjectUrl);
         if (imageObjectUrl) URL.revokeObjectURL(imageObjectUrl);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an object URL set as an anchor href via setAttribute", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const download = (blob) => {
         a.setAttribute('href', URL.createObjectURL(blob));
         a.click();
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline per-render src object URL", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const Preview = ({ file }) => <img src={URL.createObjectURL(file)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a direct state setter argument", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const onDrop = (blob) => { setUrl(URL.createObjectURL(blob)); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags object URLs passed through wrapped setter and setAttribute calls", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const assignPreview = (firstBlob: Blob, secondBlob: Blob, thirdBlob: Blob) => {
         (setUrl as (url: string) => void)(URL.createObjectURL(firstBlob));
         setPreview!(URL.createObjectURL(secondBlob));
         element["setAttribute"]("href" as string, URL.createObjectURL(thirdBlob));
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags a returned object URL", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `function make(blob) { return URL.createObjectURL(blob); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags awaited and final sequence-expression returns", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `async function makeAsync(blob) { return await URL.createObjectURL(blob); }
       function makeLogged(blob) { return (log(), URL.createObjectURL(blob)); }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags object URLs nested in returned values", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `function make(blob) { return { src: URL.createObjectURL(blob) }; }
       const makeConcise = (blob) => ({ src: URL.createObjectURL(blob) });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags nested object URLs through returned value-flow wrappers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `function makeConditional(blob, enabled) {
         return enabled ? { src: URL.createObjectURL(blob) } : null;
       }
       function makeLogical(blob, enabled) {
         return enabled && [URL.createObjectURL(blob)];
       }
       function makeSequence(blob) {
         return (log(blob), { src: URL.createObjectURL(blob) });
       }`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("ignores nested object URLs in discarded sequence operands", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `function make(blob) {
         return ({ src: URL.createObjectURL(blob) }, null);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the module revokes elsewhere", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const url = URL.createObjectURL(blob);
       img.src = url;
       URL.revokeObjectURL(url);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a page-lifetime worker src global", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the unguarded avatar preview stored in state", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const onSelect = (file) => {
         const preview = URL.createObjectURL(file);
         setAvatar(preview);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in a demo file", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `export default () => <a href={URL.createObjectURL(blob)}>download</a>;`,
      { filename: "/src/demos/index.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when URL is a local binding, not the DOM global", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const URL = getPolyfill();
       a.href = URL.createObjectURL(blob);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for an unguarded object URL assigned to a pre-declared variable", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const onSelect = (file) => {
         let preview;
         preview = URL.createObjectURL(file);
         setAvatar(preview);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an unguarded object URL is the left side of a logical expression", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const onSelect = (file) => {
         const preview = URL.createObjectURL(file) ?? fallbackUrl;
         setAvatar(preview);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for setAttribute with a non-URL attribute name", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `element.setAttribute('data-preview', URL.createObjectURL(blob));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on a bare discarded createObjectURL expression", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const warmup = (blob) => { URL.createObjectURL(blob); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an unrelated namespace URL as the browser global", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      "function make(blob) { return Vendor.URL.createObjectURL(blob); }",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an unrelated revokeObjectURL identifier as cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      "const revokeObjectURL = noop; function make(blob) { return URL.createObjectURL(blob); }",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports an explicit globalThis URL receiver", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      "function make(blob) { return globalThis.URL.createObjectURL(blob); }",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports computed and const-aliased global URL receivers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const browserGlobal = window;
       const BrowserUrl = browserGlobal["URL"];
       function make(blob) { return BrowserUrl["createObjectURL"](blob); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports a direct destructured global URL alias", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const { URL: BrowserURL } = globalThis;
       const { ["URL"]: DefaultBrowserURL = fallbackUrl } = globalThis;
       function make(blob) { return BrowserURL.createObjectURL(blob); }
       function makeDefaulted(blob) { return DefaultBrowserURL.createObjectURL(blob); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a nested destructured URL as the global namespace", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const { child: { URL: NestedURL } } = globalThis;
       function make(blob) { return NestedURL.createObjectURL(blob); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags static computed DOM URL escape APIs", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `anchor["href"] = URL.createObjectURL(firstBlob);
       element["setAttribute"]("href", URL.createObjectURL(secondBlob));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags const-aliased computed URL escape properties", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const hrefProperty = \`href\`;
       const srcProperty = "src";
       const aliasedSrcProperty = srcProperty;
       const currentBaseProperty = \`current\`;
       const currentProperty = currentBaseProperty;
       const setAttributeMethod = \`setAttribute\`;
       const attributeBase = \`href\`;
       const attributeName = attributeBase;
       anchor[hrefProperty] = URL.createObjectURL(firstBlob);
       image[aliasedSrcProperty] = URL.createObjectURL(secondBlob);
       previewRef[currentProperty] = URL.createObjectURL(thirdBlob);
       element[setAttributeMethod](attributeName, URL.createObjectURL(fourthBlob));
       const make = (blob) => URL.createObjectURL(blob);
       const attachPreview = (blob) => {
         const url = make(blob);
         image[srcProperty] = url;
       };`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("ignores computed properties that are not proven URL sinks", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const titleProperty = "title";
       const dynamicProperty = getProperty();
       element[titleProperty] = URL.createObjectURL(firstBlob);
       element[dynamicProperty] = URL.createObjectURL(secondBlob);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports repeatable dynamic-key cache stores without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       function renderPreview(blob) { return URL.createObjectURL(blob); }
       async function generatePreview(blob, id) {
         const url = await renderPreview(blob);
         previewCache.set(id, url);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports repeatable async cache stores without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = async (source) => {
         const blob = await source.convertToBlob();
         return URL.createObjectURL(blob);
       };
       async function generatePreview(source, id) {
         const url = await renderPreview(source);
         previewCache.set(id, url);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports repeatable concise-helper cache stores without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const generatePreview = (blob, id) => {
         const url = renderPreview(blob);
         previewCache.set(id, url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports direct repeatable cache stores without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const cachePreview = async (blob, id) => {
         previewCache.set(id, await renderPreview(blob));
         previewCache.set(id + '-sync', renderPreview(blob));
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports direct createObjectURL cache stores without replacement cleanup", () => {
    const unsafeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const MapConstructor = globalThis.Map;
       const previewCache = new MapConstructor();
       const cachePreview = (blob, id) => {
         previewCache.set(id, URL.createObjectURL(blob));
       };`,
    );
    expect(unsafeResult.diagnostics).toHaveLength(1);

    const safeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       previewCache.set("initial", URL.createObjectURL(initialBlob));
       const cachePreview = (blob, id) => {
         const previousUrl = previewCache.get(id);
         if (previousUrl) URL.revokeObjectURL(previousUrl);
         previewCache.set(id, URL.createObjectURL(blob));
       };
       const cacheUniquePreview = (blob) => {
         previewCache.set(URL.createObjectURL(blob), metadata);
       };`,
    );
    expect(safeResult.diagnostics).toHaveLength(0);
  });

  it("reports guarded helper results stored without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => blob && URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         previewCache.set(id, renderPreview(blob));
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("correlates helper results through call-site value-flow wrappers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         previewCache.set(id, blob && renderPreview(blob));
         const url = blob ? renderPreview(blob) : null;
         if (url) URL.revokeObjectURL(url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat cleanup of a previous binding value as cleanup of a later result", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const renderPreview = (blob) => URL.createObjectURL(blob);
       let url = getPreviousPreview();
       URL.revokeObjectURL(url);
       url = renderPreview(blob);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not correlate cleanup with overwritten result values", () => {
    const overwrittenResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob) => {
         let url = make(blob);
         setPreview(url);
         url = getFallback();
         URL.revokeObjectURL(url);
       };`,
    );
    expect(overwrittenResult.diagnostics).toHaveLength(1);

    const loopResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreviews = (blobs) => {
         let url;
         for (const blob of blobs) {
           url = make(blob);
           setPreview(url);
         }
         if (url) URL.revokeObjectURL(url);
       };`,
    );
    expect(loopResult.diagnostics).toHaveLength(1);
  });

  it("recognizes cleanup through exact result, helper, and cleanup aliases", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const makeAlias = make;
       const first = (blob) => {
         const url = make(blob);
         const alias = url;
         return () => URL.revokeObjectURL(alias);
       };
       const second = (blob) => {
         const url = makeAlias(blob);
         return () => URL.revokeObjectURL(url);
       };
       const third = (blob) => {
         const url = make(blob);
         const cleanup = () => URL.revokeObjectURL(url);
         const alias = cleanup;
         return alias;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a loop cache store without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const cachePreviews = (blobs) => {
         for (const blob of blobs) {
           const url = renderPreview(blob);
           if (url) previewCache.set(blob.name, url);
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a cache store behind a nested unrelated condition", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const url = renderPreview(blob);
       if (url) {
         if (shouldCache) previewCache.set("preview", url);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust an unrelated conditional cache store", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const url = renderPreview(blob);
       if (shouldCache) previewCache.set("preview", url);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for Set caches and statically computed cache stores", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Set();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob) => {
         (previewCache as Set<string>)[\`add\`](renderPreview(blob));
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for module caches constructed through proven global aliases", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const MapConstructor = globalThis.Map;
       const { Set: SetConstructor } = globalThis;
       const firstPreviewCache = new MapConstructor();
       const secondPreviewCache = new SetConstructor();
       const thirdPreviewCache = new globalThis.Map();
       const make = (blob) => URL.createObjectURL(blob);
       firstPreviewCache.set("first", make(firstBlob));
       secondPreviewCache.add(make(secondBlob));
       thirdPreviewCache.set("third", make(thirdBlob));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports repeatable cache alias stores without replacement cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         const cacheAlias = previewCache;
         cacheAlias.set(id, make(blob));
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a cache constructed through an unproven collection alias", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const MapConstructor = customCollections.Map;
       const previewCache = new MapConstructor();
       const make = (blob) => URL.createObjectURL(blob);
       previewCache.set("preview", make(blob));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a reassigned module cache binding", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `let previewCache = new Map();
       const renderPreview = (blob) => URL.createObjectURL(blob);
       previewCache = getCustomStore();
       const cachePreview = (blob, id) => {
         previewCache.set(id, renderPreview(blob));
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust conditional or disconnected cache stores", () => {
    const conditionalResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const url = make(blob);
       if (false) previewCache.set("x", url);`,
    );
    expect(conditionalResult.diagnostics).toHaveLength(1);

    const disconnectedResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const url = make(blob);
       function neverCalled() { previewCache.set("x", url); }`,
    );
    expect(disconnectedResult.diagnostics).toHaveLength(1);
  });

  it("does not trust a cache that evicts retained object URLs", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const url = make(blob);
       previewCache.set("x", url);
       previewCache.clear();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires replacement cleanup even when later eviction cleanup exists", () => {
    const deleteResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => previewCache.set(id, make(blob));
       const evictPreview = (id) => {
         const url = previewCache.get(id);
         if (url) URL.revokeObjectURL(url);
         previewCache.delete(id);
       };`,
    );
    expect(deleteResult.diagnostics).toHaveLength(1);

    const clearResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => previewCache.set(id, make(blob));
       const clearPreviews = () => {
         previewCache.forEach((url) => URL.revokeObjectURL(url));
         previewCache.clear();
       };`,
    );
    expect(clearResult.diagnostics).toHaveLength(1);
  });

  it("accepts repeatable cache stores that revoke the replaced value first", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         const previousUrl = previewCache.get(id);
         if (previousUrl) URL.revokeObjectURL(previousUrl);
         previewCache.set(id, make(blob));
       };
       const clearPreviews = () => {
         previewCache.forEach((url) => URL.revokeObjectURL(url));
         previewCache.clear();
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects repeated static cache replacement without cleanup", () => {
    const unsafeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob) => previewCache.set("same", make(blob));`,
    );
    expect(unsafeResult.diagnostics).toHaveLength(1);

    const safeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob) => {
         const previousUrl = previewCache.get("same");
         if (previousUrl) URL.revokeObjectURL(previousUrl);
         previewCache.set("same", make(blob));
       };`,
    );
    expect(safeResult.diagnostics).toHaveLength(0);

    const repeatedLocalKeyResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const makeFirst = (blob) => URL.createObjectURL(blob);
       const makeSecond = (blob) => URL.createObjectURL(blob);
       const cachePreview = (firstBlob, secondBlob, id) => {
         previewCache.set(id, makeFirst(firstBlob));
         previewCache.set(id, makeSecond(secondBlob));
       };`,
    );
    expect(repeatedLocalKeyResult.diagnostics).toHaveLength(2);
  });

  it("recognizes object URLs retained as cache keys and nested values", () => {
    const keyResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const url = make(blob);
       previewCache.set(url, metadata);`,
    );
    expect(keyResult.diagnostics).toHaveLength(0);

    const nestedResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const url = make(blob);
       previewCache.set("x", { url });`,
    );
    expect(nestedResult.diagnostics).toHaveLength(0);
  });

  it("stays quiet when every returned object URL is revoked", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const download = (blob) => {
         const url = make(blob);
         anchor.href = url;
         anchor.click();
         URL.revokeObjectURL(url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("indexes disposed calls through object methods and immutable aliases", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const createMethod = \`create\`;
       const helpers = {
         [createMethod](blob) { return URL.createObjectURL(blob); },
         createArrow: (blob) => URL.createObjectURL(blob),
       };
       const helperAlias = helpers;
       const nestedAlias = helperAlias;
       const method = \`create\`;
       const methodAlias = method;
       helpers.other = externalOther;
       const usePreview = async (blob) => {
         const firstUrl = helpers.create(blob);
         URL.revokeObjectURL(firstUrl);
         const secondUrl = helperAlias.createArrow(blob);
         URL.revokeObjectURL(secondUrl);
         const thirdUrl = await nestedAlias[methodAlias](blob);
         URL.revokeObjectURL(thirdUrl);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports an object method helper when any returned URL is not disposed", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const helpers = { create: (blob) => URL.createObjectURL(blob) };
       const usePreview = (blob, shouldRevoke) => {
         const url = helpers.create(blob);
         if (shouldRevoke) URL.revokeObjectURL(url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not index reassigned direct helpers through stale initializers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `let make = (blob) => URL.createObjectURL(blob);
       make = externalCreate;
       const url = make(blob);
       URL.revokeObjectURL(url);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not index object method helpers through mutable call targets", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const firstHelpers = { create: (blob) => URL.createObjectURL(blob) };
       firstHelpers.create = externalCreate;
       const firstUrl = firstHelpers.create(blob);
       URL.revokeObjectURL(firstUrl);

       let secondHelpers = { create: (blob) => URL.createObjectURL(blob) };
       secondHelpers = externalHelpers;
       const secondUrl = secondHelpers.create(blob);
       URL.revokeObjectURL(secondUrl);

       const thirdHelpers = { create: (blob) => URL.createObjectURL(blob) };
       const thirdAlias = thirdHelpers;
       thirdAlias.create = externalCreate;
       const thirdUrl = thirdHelpers.create(blob);
       URL.revokeObjectURL(thirdUrl);

       const fourthHelpers = { create: (blob) => URL.createObjectURL(blob) };
       fourthHelpers[getKey()] = externalCreate;
       const fourthUrl = fourthHelpers.create(blob);
       URL.revokeObjectURL(fourthUrl);

       const fifthHelpers = { create: (blob) => URL.createObjectURL(blob) };
       install(fifthHelpers);
       const fifthUrl = fifthHelpers.create(blob);
       URL.revokeObjectURL(fifthUrl);`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("does not resolve mutable computed method keys", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const helpers = { create: (blob) => URL.createObjectURL(blob) };
       let method = "create";
       method = getMethod();
       const url = helpers[method](blob);
       URL.revokeObjectURL(url);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a returned cleanup closure that revokes the created URL", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob) => {
         const url = make(blob);
         setPreview(url);
         return () => URL.revokeObjectURL(url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes returned cleanup closures guarded by the created URL", () => {
    const ifGuardResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob) => {
         const url = make(blob);
         setPreview(url);
         return () => {
           if (url) URL.revokeObjectURL(url);
         };
       };`,
    );
    expect(ifGuardResult.diagnostics).toHaveLength(0);

    const logicalGuardResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob) => {
         const url = make(blob);
         setPreview(url);
         return () => url && URL.revokeObjectURL(url);
       };`,
    );
    expect(logicalGuardResult.diagnostics).toHaveLength(0);
  });

  it("does not trust cleanup behind an additional unrelated exit or condition", () => {
    const exitResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const first = (blob, skip) => {
         const url = make(blob);
         return () => {
           if (!url) return;
           if (skip) return;
           URL.revokeObjectURL(url);
         };
       };`,
    );
    expect(exitResult.diagnostics).toHaveLength(1);

    const conditionResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const second = (blob, shouldRevoke) => {
         const url = make(blob);
         return () => {
           if (url) {
             if (shouldRevoke) URL.revokeObjectURL(url);
           }
         };
       };`,
    );
    expect(conditionResult.diagnostics).toHaveLength(1);
  });

  it("recognizes cleanup across exhaustive if and else branches", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob, mode) => {
         const url = make(blob);
         setPreview(url);
         if (mode) URL.revokeObjectURL(url);
         else URL.revokeObjectURL(url);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags hard DOM escapes through bound URL aliases", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const usePreview = (blob) => {
         const url = URL.createObjectURL(blob);
         const alias = url;
         anchor.href = alias;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores createObjectURL on a mutated global URL alias", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const BrowserURL = URL;
       BrowserURL.createObjectURL = () => "x";
       const make = (blob) => BrowserURL.createObjectURL(blob);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags direct escapes through setter and computed method aliases", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const setter = setPreview;
       setter(URL.createObjectURL(firstBlob));
       const method = "setAttribute";
       element[method]("href", URL.createObjectURL(secondBlob));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("indexes large returned-helper programs once", () => {
    const helperDeclarations = Array.from(
      { length: 800 },
      (_, index) => `const make${index} = (blob) => URL.createObjectURL(blob);`,
    ).join("\n");
    const helperCalls = Array.from(
      { length: 800 },
      (_, index) =>
        `const url${index} = make${index}(blob${index}); URL.revokeObjectURL(url${index});`,
    ).join("\n");
    const result = runRule(noCreateObjectUrlWithoutRevoke, `${helperDeclarations}\n${helperCalls}`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust an unrelated guard inside a returned cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob, shouldCleanUp) => {
         const url = make(blob);
         setPreview(url);
         return () => {
           if (shouldCleanUp) URL.revokeObjectURL(url);
         };
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes guarded stored cleanups returned through wrappers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob: Blob) => URL.createObjectURL(blob);
       const usePreview = (blob: Blob) => {
         const url = make(blob);
         setPreview(url);
         const cleanup = () => {
           if (!url) return;
           URL.revokeObjectURL(url);
         };
         return (cleanup satisfies () => void);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a positive ternary guard inside a returned cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob) => {
         const url = make(blob);
         setPreview(url);
         return () => url ? URL.revokeObjectURL(url) : undefined;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a stored cleanup returned through TypeScript wrappers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob: Blob) => URL.createObjectURL(blob);
       const usePreview = (blob: Blob) => {
         const url = make(blob);
         setPreview(url);
         const cleanup = () => URL.revokeObjectURL(url);
         return (cleanup as () => void);
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a cleanup closure returned only conditionally", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob, shouldCleanUp) => {
         const url = make(blob);
         setPreview(url);
         if (shouldCleanUp) return () => URL.revokeObjectURL(url);
         return () => {};
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let an unrelated revoke suppress an escaping creation", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const releaseOld = (oldUrl) => URL.revokeObjectURL(oldUrl);
       const make = (blob) => URL.createObjectURL(blob);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags escaped object URLs through TypeScript expression wrappers", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const assignUrl = (blob: Blob) => {
         anchor.href = URL.createObjectURL(blob) as string;
       };
       const useUrl = (data?: Blob) => {
         const url = data && (URL.createObjectURL(data) satisfies string);
         setUrl(url);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a returned URL when one call site bypasses the module cache", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       function renderPreview(blob) { return URL.createObjectURL(blob); }
       async function generatePreview(blob, id) {
         const url = await renderPreview(blob);
         previewCache.set(id, url);
       }
       const leaked = renderPreview(otherBlob);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept a cache sweep that runs before the retained URL is stored", () => {
    const forEachResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const use = (blob, id) => {
         previewCache.forEach((url) => URL.revokeObjectURL(url));
         previewCache.set(id, make(blob));
         previewCache.clear();
       };`,
    );
    expect(forEachResult.diagnostics).toHaveLength(1);

    const forOfResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const use = (blob, id) => {
         const previousUrl = previewCache.get(id);
         if (previousUrl) URL.revokeObjectURL(previousUrl);
         for (const url of previewCache.values()) URL.revokeObjectURL(url);
         previewCache.set(id, make(blob));
         previewCache.clear();
       };`,
    );
    expect(forOfResult.diagnostics).toHaveLength(1);

    const reorderedForOfResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const use = (blob, id) => {
         const previousUrl = previewCache.get(id);
         if (previousUrl) URL.revokeObjectURL(previousUrl);
         previewCache.set(id, make(blob));
         for (const url of previewCache.values()) URL.revokeObjectURL(url);
         previewCache.clear();
       };`,
    );
    expect(reorderedForOfResult.diagnostics).toHaveLength(0);
  });

  it("matches cache sweeps to the retained Map slot", () => {
    const nestedSafeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const use = (blob) => {
         const previous = previewCache.get("preview");
         if (previous) URL.revokeObjectURL(previous.url);
         previewCache.set("preview", { url: make(blob) });
       };
       const clear = () => {
         previewCache.forEach((entry) => URL.revokeObjectURL(entry.url));
         previewCache.clear();
       };`,
    );
    expect(nestedSafeResult.diagnostics).toHaveLength(0);

    const nestedUnsafeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       previewCache.set("preview", { url: make(blob) });
       previewCache.forEach((entry) => URL.revokeObjectURL(entry));
       previewCache.clear();`,
    );
    expect(nestedUnsafeResult.diagnostics).toHaveLength(1);

    const keyUnsafeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       previewCache.set(make(blob), metadata);
       previewCache.forEach((value) => URL.revokeObjectURL(value));
       previewCache.clear();`,
    );
    expect(keyUnsafeResult.diagnostics).toHaveLength(1);
  });

  it("accepts Set element cleanup before deletion", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Set();
       const make = (blob) => URL.createObjectURL(blob);
       const url = make(blob);
       previewCache.add(url);
       URL.revokeObjectURL(url);
       previewCache.delete(url);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts nested Map value and Map key cleanup before deletion", () => {
    const nestedValueResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         const previous = previewCache.get(id);
         if (previous) URL.revokeObjectURL(previous.preview.url);
         previewCache.set(id, { preview: { url: make(blob) } });
       };
       const evictPreview = (id) => {
         const entry = previewCache.get(id);
         if (!entry) return;
         URL.revokeObjectURL(entry.preview.url);
         previewCache.delete(id);
       };
       const evictPreviewAlias = (id) => {
         const entry = previewCache.get(id);
         if (!entry) return;
         const url = entry.preview.url;
         URL.revokeObjectURL(url);
         previewCache.delete(id);
       };
       const evictPreviewIntermediateAlias = (id) => {
         const entry = previewCache.get(id);
         if (!entry) return;
         const preview = entry.preview;
         URL.revokeObjectURL(preview.url);
         previewCache.delete(id);
       };
       const evictPreviewDestructure = (id) => {
         const entry = previewCache.get(id);
         if (!entry) return;
         const { preview: { url } } = entry;
         URL.revokeObjectURL(url);
         previewCache.delete(id);
       };
       const evictPreviewStaticComputedDestructure = (id) => {
         const entry = previewCache.get(id);
         if (!entry) return;
         const { ["preview"]: { [\`url\`]: url } } = entry;
         URL.revokeObjectURL(url);
         previewCache.delete(id);
       };`,
    );
    expect(nestedValueResult.diagnostics).toHaveLength(0);

    const reassignedEntryResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         const previous = previewCache.get(id);
         if (previous) URL.revokeObjectURL(previous.preview.url);
         previewCache.set(id, { preview: { url: make(blob) } });
       };
       const evictPreview = (id, replacement) => {
         let entry = previewCache.get(id);
         if (!entry) return;
         entry = replacement;
         const url = entry.preview.url;
         URL.revokeObjectURL(url);
         previewCache.delete(id);
       };`,
    );
    expect(reassignedEntryResult.diagnostics).toHaveLength(1);

    const mapKeyResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob) => {
         const url = make(blob);
         previewCache.set(url, metadata);
       };
       const evictPreview = (url) => {
         URL.revokeObjectURL(url);
         previewCache.delete(url);
       };`,
    );
    expect(mapKeyResult.diagnostics).toHaveLength(0);

    const conditionalNestedValueResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       previewCache.set("preview", { preview: { url: make(blob) } });
       const evictPreview = (enabled) => {
         const entry = previewCache.get("preview");
         if (enabled) URL.revokeObjectURL(entry.preview.url);
         previewCache.delete("preview");
       };`,
    );
    expect(conditionalNestedValueResult.diagnostics).toHaveLength(1);

    const dynamicDestructureResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       previewCache.set("preview", { preview: { url: make(blob) } });
       const evictPreview = (propertyName) => {
         const entry = previewCache.get("preview");
         const { [propertyName]: { url } } = entry;
         URL.revokeObjectURL(url);
         previewCache.delete("preview");
       };`,
    );
    expect(dynamicDestructureResult.diagnostics).toHaveLength(1);
  });

  it("rejects conditional cache eviction cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       const cachePreview = (blob, id) => {
         const previous = previewCache.get(id);
         if (previous) URL.revokeObjectURL(previous);
         previewCache.set(id, make(blob));
       };
       const evict = (id, enabled) => {
         const oldUrl = previewCache.get(id);
         enabled && URL.revokeObjectURL(oldUrl);
         previewCache.delete(id);
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags hard escapes through pre-declared bindings", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const use = (blob) => {
         let url;
         url = URL.createObjectURL(blob);
         const alias = url;
         anchor.href = alias;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates direct and downstream mutated global URL namespaces", () => {
    const createResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `URL.createObjectURL = fake;
       anchor.href = URL.createObjectURL(blob);`,
    );
    expect(createResult.diagnostics).toHaveLength(0);

    const downstreamAliasResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const BrowserURL = URL;
       const MutableURL = BrowserURL;
       MutableURL.createObjectURL = fake;
       anchor.href = BrowserURL.createObjectURL(blob);`,
    );
    expect(downstreamAliasResult.diagnostics).toHaveLength(0);

    const revokeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const use = (blob) => {
         const url = make(blob);
         anchor.href = url;
         URL.revokeObjectURL = fake;
         URL.revokeObjectURL(url);
       };`,
    );
    expect(revokeResult.diagnostics).toHaveLength(1);
  });

  it("flags conditional state setters and computed attribute aliases", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const setter = enabled ? setPreview : setAvatar;
       setter(URL.createObjectURL(firstBlob));
       const method = "setAttribute";
       const attribute = "href";
       element[method](attribute, URL.createObjectURL(secondBlob));`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("tracks the exact produced binding version through aliases and writes", () => {
    const staleAliasResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       let url;
       const oldUrl = url;
       url = make(blob);
       anchor.href = url;
       URL.revokeObjectURL(oldUrl);`,
    );
    expect(staleAliasResult.diagnostics).toHaveLength(1);

    const destructuringWriteResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       let url = make(blob);
       anchor.href = url;
       ({ url } = getOther());
       URL.revokeObjectURL(url);`,
    );
    expect(destructuringWriteResult.diagnostics).toHaveLength(1);

    const preservedAliasResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       let url = make(blob);
       const originalUrl = url;
       anchor.href = originalUrl;
       url = getFallback();
       URL.revokeObjectURL(originalUrl);`,
    );
    expect(preservedAliasResult.diagnostics).toHaveLength(0);
  });

  it("rejects returned cleanup behind unrelated conditional execution", () => {
    const cases = [
      `return () => { if (enabled) { if (url) URL.revokeObjectURL(url); } };`,
      `return () => enabled && URL.revokeObjectURL(url);`,
      `return () => enabled ? URL.revokeObjectURL(url) : undefined;`,
      `return () => { if (skip) return; if (!url) return; URL.revokeObjectURL(url); };`,
    ];
    for (const cleanup of cases) {
      const result = runRule(
        noCreateObjectUrlWithoutRevoke,
        `const make = (blob) => URL.createObjectURL(blob);
         const use = (blob, enabled, skip) => {
           const url = make(blob);
           setPreview(url);
           ${cleanup}
         };`,
      );
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not accept exhaustive cleanup after a conditional early exit", () => {
    const branchResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const attachPreview = (blob, shouldSkip, branch) => {
         const url = make(blob);
         anchor.href = url;
         if (branch) {
           if (shouldSkip) return;
           URL.revokeObjectURL(url);
         } else {
           URL.revokeObjectURL(url);
         }
       };`,
    );
    expect(branchResult.diagnostics).toHaveLength(1);

    const throwResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const attachPreview = (blob, shouldSkip, branch) => {
         const url = make(blob);
         anchor.href = url;
         if (branch) {
           if (shouldSkip) throw new Error("skip");
           URL.revokeObjectURL(url);
         } else {
           URL.revokeObjectURL(url);
         }
       };`,
    );
    expect(throwResult.diagnostics).toHaveLength(1);

    const switchResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const attachPreview = (blob, shouldSkip, mode) => {
         const url = make(blob);
         anchor.href = url;
         switch (mode) {
           case "preview":
             if (shouldSkip) break;
             URL.revokeObjectURL(url);
             break;
           default:
             URL.revokeObjectURL(url);
         }
       };`,
    );
    expect(switchResult.diagnostics).toHaveLength(1);

    const cacheResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const previewCache = new Map();
       const make = (blob) => URL.createObjectURL(blob);
       previewCache.set("preview", make(blob));
       const clearPreviews = (shouldSkip) => {
         previewCache.forEach((url) => {
           if (shouldSkip) return;
           URL.revokeObjectURL(url);
         });
         previewCache.clear();
       };`,
    );
    expect(cacheResult.diagnostics).toHaveLength(1);

    const internalTransferResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const attachPreview = (blob, shouldThrow, branch, mode) => {
         const url = make(blob);
         anchor.href = url;
         if (branch) {
           try {
             if (shouldThrow) throw new Error("handled");
           } catch {}
           switch (mode) {
             case "preview":
               break;
           }
           URL.revokeObjectURL(url);
         } else {
           URL.revokeObjectURL(url);
         }
       };`,
    );
    expect(internalTransferResult.diagnostics).toHaveLength(0);
  });

  it("requires exhaustive cleanup to dominate the created URL", () => {
    const cases = [
      `if (enabled) { if (mode) URL.revokeObjectURL(url); else URL.revokeObjectURL(url); }`,
      `if (skip) return; if (mode) URL.revokeObjectURL(url); else URL.revokeObjectURL(url);`,
      `while (enabled) { if (mode) URL.revokeObjectURL(url); else URL.revokeObjectURL(url); break; }`,
    ];
    for (const cleanup of cases) {
      const result = runRule(
        noCreateObjectUrlWithoutRevoke,
        `const make = (blob) => URL.createObjectURL(blob);
         const use = (blob, enabled, skip, mode) => {
           const url = make(blob);
           setPreview(url);
           ${cleanup}
         };`,
      );
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("recognizes exhaustive switch cleanup with a default", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const use = (blob, mode) => {
         const url = make(blob);
         setPreview(url);
         switch (mode) {
           case 1:
             URL.revokeObjectURL(url);
             break;
           default:
             URL.revokeObjectURL(url);
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a switch continue as fallthrough to cleanup", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const use = (blobs, mode) => {
         for (const blob of blobs) {
           const url = make(blob);
           setPreview(url);
           switch (mode) {
             case 1:
               continue;
             case 2:
               URL.revokeObjectURL(url);
               break;
             default:
               URL.revokeObjectURL(url);
           }
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses exact produced aliases for exhaustive cleanup", () => {
    const staleAliasResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       let url;
       const oldUrl = url;
       url = make(blob);
       anchor.href = url;
       if (mode) URL.revokeObjectURL(oldUrl);
       else URL.revokeObjectURL(oldUrl);`,
    );
    expect(staleAliasResult.diagnostics).toHaveLength(1);

    const preservedAliasResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       let url = make(blob);
       const originalUrl = url;
       anchor.href = originalUrl;
       url = fallback();
       if (mode) URL.revokeObjectURL(originalUrl);
       else URL.revokeObjectURL(originalUrl);`,
    );
    expect(preservedAliasResult.diagnostics).toHaveLength(0);
  });

  it("detects destructuring writes in for-of targets", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       let url = make(blob);
       anchor.href = url;
       for ({ url } of items) {}
       URL.revokeObjectURL(url);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects positive URL guards inside optionally executed regions", () => {
    const cleanupBodies = [
      `while (enabled) { if (url) URL.revokeObjectURL(url); break; }`,
      `for (; enabled; ) { if (url) URL.revokeObjectURL(url); break; }`,
      `switch (mode) { case 1: if (url) URL.revokeObjectURL(url); }`,
      `try { use(url); } catch { if (url) URL.revokeObjectURL(url); }`,
    ];
    for (const cleanupBody of cleanupBodies) {
      const result = runRule(
        noCreateObjectUrlWithoutRevoke,
        `const make = (blob) => URL.createObjectURL(blob);
         const usePreview = (blob, enabled, mode) => {
           const url = make(blob);
           setPreview(url);
           return () => { ${cleanupBody} };
         };`,
      );
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("rejects cleanup bypassed by a loop continue", () => {
    const result = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreviews = (blobs, skip) => {
         for (const blob of blobs) {
           const url = make(blob);
           setPreview(url);
           if (skip) continue;
           if (url) URL.revokeObjectURL(url);
           break;
         }
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("only treats control transfers after acquisition as cleanup bypasses", () => {
    const safeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreviews = (blobs, skip) => {
         for (const blob of blobs) {
           if (skip) continue;
           const url = make(blob);
           setPreview(url);
           if (url) URL.revokeObjectURL(url);
         }
       };`,
    );
    expect(safeResult.diagnostics).toHaveLength(0);

    const unsafeResult = runRule(
      noCreateObjectUrlWithoutRevoke,
      `const make = (blob) => URL.createObjectURL(blob);
       const usePreview = (blob, skip) => {
         const url = make(blob);
         setPreview(url);
         if (skip) return;
         if (url) URL.revokeObjectURL(url);
       };`,
    );
    expect(unsafeResult.diagnostics).toHaveLength(1);
  });
});
