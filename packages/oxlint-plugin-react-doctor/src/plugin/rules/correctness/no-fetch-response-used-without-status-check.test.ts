import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchResponseUsedWithoutStatusCheck } from "./no-fetch-response-used-without-status-check.js";

describe("no-fetch-response-used-without-status-check", () => {
  it("flags a .then callback consuming json without a status check", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch(url, { signal }).then(async (response) => ({
         emojis: await response.json(),
       }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an awaited response consumed without a status check", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         const data = await response.json();
         return data;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows const aliases of an awaited Response", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         const firstAlias = response as Response;
         const secondAlias = firstAlias;
         return secondAlias.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a status guard through a const Response alias", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         const checkedResponse = response;
         if (!checkedResponse.ok) throw new Error(checkedResponse.statusText);
         return response.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not follow a mutable Response alias", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         let currentResponse = response;
         currentResponse = await loadFallbackResponse();
         return currentResponse.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags type-wrapped response body consumers without treating the response as escaped", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function loadAsserted() {
         const response = await fetch(endpoint);
         return (response as Response).json();
       }
       async function loadNonNull() {
         const response = await fetch(endpoint);
         return response!.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags immediate double-await consumption", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const data = await (await fetch(url)).json();
         return data;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a dead truthiness guard on the Response", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function reload() {
         const shouldReload = await fetch(url);
         if (!shouldReload) return;
         const json = await shouldReload.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when the Response is returned to the caller", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function http(url, options) {
         const response = await fetch(url, options);
         const json = await response.json();
         return { response, json };
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when response.ok is checked before consuming", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         if (!response.ok) throw new Error(response.statusText);
         return response.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when response.status is checked", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function reload() {
         const shouldReload = await fetch(url);
         if (shouldReload.status !== 200) return;
         const json = await shouldReload.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a then callback consumes the response in a successful ternary branch", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch("/api/init").then((response) => response.ok ? response.json() : null);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a then callback whose status ternary does not guard the consumed branch", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch("/api/init").then((response) => flag ? response.ok : response.json());`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when the status is read only after the body is consumed", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const load = async () => {
        const response = await fetch("/api/items");
        const body = await response.json();
        if (!response.ok) throw new Error("failed");
        return body;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags when the only status read is inside a deferred nested function", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const load = async () => {
        const response = await fetch("/api/items");
        const checkLater = () => response.ok;
        void checkLater;
        return response.json();
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for an imported / aliased fetch wrapper", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `import { fetch } from 'cross-fetch';
       async function load() {
         const response = await fetch(endpoint);
         const data = await response.json();
         return data;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a member-call wrapper (api.fetch)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await api.fetch(endpoint);
         const data = await response.json();
         return data;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when fetch appears only inside a comment", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `// fetch(url).then((r) => r.json())
       const value = 1;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the Response is returned without being consumed", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function raw(url) {
         const response = await fetch(url);
         return response;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the Response is passed to a throw-on-error validator (assertOk idiom)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         assertOk(response);
         return response.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when ok/status is checked through destructuring", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(endpoint);
         const { ok, status } = response;
         if (!ok) throw new Error(String(status));
         return response.json();
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on the live offline-ping guard (`let response; try { response = await fetch } catch {}`)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function ping() {
         let response;
         try {
           response = await fetch(url);
         } catch {}
         if (!response) setOffline(true);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when only a shadowed inner response is consumed, not the outer fetch Response", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function warmCache() {
         const response = await fetch(url);
         registerRefresh(async () => {
           const response = await client.load(other);
           const data = await response.json();
           return data;
         });
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an unchecked consume even when a shadowed inner response is ok-checked", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         const response = await fetch(url);
         const data = await response.json();
         onRefresh(async () => {
           const response = await authorizedFetch(other);
           if (!response.ok) throw new Error();
           return response.json();
         });
         return data;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the flagship pattern at module top level (top-level await)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const response = await fetch(url);
       const data = await response.json();
       export default data;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a body consume even when a later .catch handles rejection", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch(url)
         .then((response) => response.json())
         .then((posts) => setPosts(posts))
         .catch(() => setPosts([]));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a discarded drain with a two-argument rejection handler", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch(url).then(
         (response) => response.json(),
         (error) => setError(error),
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a chain whose only .catch merely logs", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch(url)
         .then((response) => response.json())
         .then(setData)
         .catch((error) => console.error(error));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a body consume even when an enclosing try/catch handles rejection", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         try {
           const response = await fetch(url);
           const data = await response.json();
           setItems(data);
         } catch (error) {
           setError(error);
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an awaited consume whose enclosing catch only logs", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() {
         try {
           const response = await fetch(url);
           const data = await response.json();
           setItems(data);
         } catch (error) {
           console.error(error);
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet when fetching a data: URL literal (no HTTP status possible)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch('data:image/png;base64,AAAA')
         .then((response) => response.blob())
         .then(save);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when fetching a data: template URL through a local binding", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function download(mime, base64) {
         const dataUrl = \`data:\${mime};base64,\${base64}\`;
         const blob = await fetch(dataUrl).then((response) => response.blob());
         save(blob);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when fetching a blob: object URL", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function read(objectUrl) {
         const blobUrl = 'blob:' + objectUrl;
         const response = await fetch(blobUrl);
         const buffer = await response.arrayBuffer();
         return buffer;
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an awaited body consume even when an enclosing catch handles rejection", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function download(url) {
         try {
           const blob = await fetch(url).then((response) => response.blob());
           save(blob);
         } catch (error) {
           setError('Failed to download');
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a non-awaited .then chain inside a materializing try (the try never sees the rejection)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function load(url) {
         try {
           fetch(url)
             .then((response) => response.json())
             .then(setData);
         } catch (error) {
           setError(error);
         }
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an awaited .then consume with no try (getServerSideProps shape)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export async function getServerSideProps() {
         const repositoryData = await fetch(
           'https://api.github.com/repos/example/repo'
         ).then((res) => res.json());
         return { props: { repositoryData } };
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an https template URL resolved through a constant base", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const BASE_URL = 'https://internxt.com';
       async function getDownloadAppUrl() {
         const fetchDownloadResponse = await fetch(\`\${BASE_URL}/api/download\`, { method: 'GET' });
         const response = await fetchDownloadResponse.json();
         return response.platforms;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet in gatsby-node build scripts", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export const sourceNodes = async () => {
         const response = await fetch('https://api.github.com/repos/example/repo');
         const data = await response.json();
         return data;
       };`,
      { filename: "docs/gatsby-node.mjs" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in Storybook loader/demo files", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function loadAvatar() {
         const response = await fetch(endpoint);
         const data = await response.json();
         render(data);
       }`,
      { filename: "src/components/avatar.stories.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: canvas.toDataURL() data: URL fetched through a binding (canvas → Blob export)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function exportCanvasAsBlob(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL('image/png');
  const response = await fetch(dataUrl);
  const pngBlob = await response.blob();
  return pngBlob;
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Inline canvas.toDataURL argument with double-await (dataURL → File helper)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function canvasToFile(canvas: HTMLCanvasElement, fileName: string) {
  const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
  return new File([blob], fileName, { type: 'image/png' });
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: URL.createObjectURL blob: URL fetched and revoked in finally", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function fileToArrayBuffer(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const response = await fetch(objectUrl);
    const buffer = await response.arrayBuffer();
    return buffer;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer an inert URL from a parameter name", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a helper call-site catch as an HTTP status check", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function useUsers(url: string) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const response = await fetch(url);
      const data = await response.json();
      if (!cancelled) setUsers(data);
    };
    load().catch((loadError) => {
      if (!cancelled) setError(loadError);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { users, error };
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags every unchecked response inside an awaited Promise.all", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function loadAll() {
  try {
    const [user, posts] = await Promise.all([
      fetch('/api/user').then((response) => response.json()),
      fetch('/api/posts').then((response) => response.json()),
    ]);
    setUser(user);
    setPosts(posts);
  } catch (error) {
    setError(error);
  }
}`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags an unchecked response inside an awaited Promise.race", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function loadWithTimeout(url: string) {
  try {
    const rows = await Promise.race([
      fetch(url).then((response) => response.json()),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), 5000),
      ),
    ]);
    setRows(rows);
  } catch (error) {
    setError(error);
  }
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: Cache-warming prefetch that discards the body with an explicit error swallow", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function prefetchThumbnail(url: string) {
  fetch(url)
    .then((response) => response.blob())
    .catch(() => {});
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an http fetch consumed in a helper whose call site has no rejection handling", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function usePosts() {
         const [posts, setPosts] = useState([]);
         useEffect(() => {
           const load = async () => {
             const response = await fetch("/api/posts");
             const data = await response.json();
             setPosts(data);
           };
           load();
         }, []);
         return posts;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a discarded chain with no rejection handler at all", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function warmCache(url) {
         fetch(url).then((response) => response.blob());
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet on a bundler-emitted require(...) asset URL assigned in try/catch (cboard markdown idiom)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function loadHelpText(lang) {
         let markdownPath = '';
         try {
           markdownPath = require(\`../translations/\${lang}.md\`);
         } catch (err) {
           markdownPath = require('../translations/en-US.md');
         }
         fetch(markdownPath)
           .then((response) => response.text())
           .then((text) => setMarkdown(text));
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet on an inline require(...) asset URL", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch(require('./assets/help.md')).then((response) => response.text()).then(setHelp);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a binding assigned from a non-require call in try/catch", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function loadHelpText() {
         let helpUrl = '';
         try {
           helpUrl = resolveHelpUrl();
         } catch (err) {
           helpUrl = '/help/en-US';
         }
         fetch(helpUrl)
           .then((response) => response.text())
           .then((text) => setMarkdown(text));
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks rendered docs-site .demo. files", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const fetchPokemon = async (name) =>
         fetch(\`https://pokeapi.co/api/v2/pokemon/\${name}\`).then((response) => response.json());`,
      { filename: "src/hooks/useHover/useHover.demo.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet in testUtils directories (mock fetch helpers)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `const mockGremlinFetch = () => async (queryTemplate) => {
         const res = await fetch(\`http://mock.test?gremlin=\${queryTemplate}\`);
         return res.json();
       };`,
      { filename: "src/connector/testUtils/mockGremlinFetch.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not confuse parsed-body status with the HTTP response status", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function verifyTask(props) {
         const res = await fetch('/tasks_verification', { method: 'POST' });
         const jsonResponse = await res.json();
         if (jsonResponse.status !== 201 && jsonResponse.statusCode !== 201) {
           throw new Error(jsonResponse.message);
         }
         return jsonResponse;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a parsed body whose non-status properties are the only reads", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function loadUser() {
         const res = await fetch('/api/user');
         const data = await res.json();
         setName(data.name);
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an unchecked response inside an empty fail-open catch", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function moderate(text) {
         try {
           const upstream = await fetch('/moderate-text', { method: 'POST' });
           const verdict = await upstream.json();
           if (verdict.allowed === false) {
             return { blocked: true };
           }
         } catch {
           // fail-open: moderation infra never blocks publish
         }
         return { blocked: false };
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a value-producing chain even when a later catch swallows rejection", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `function loadTitle(endpoint) {
         fetch(endpoint)
           .then((r) => r.json())
           .then((data) => {
             if (typeof data.title === 'string') setEmbedTitle(data.title);
           })
           .catch(() => {});
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet: bundled asset fetched via new URL(..., import.meta.url)", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export async function GET() {
         const fontData = await fetch(
           new URL('../../public/fonts/RobotoMono-Regular.ttf', import.meta.url),
         ).then((res) => res.arrayBuffer());
         return new ImageResponse(fontData);
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a new URL() fetch whose base is not import.meta.url", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export async function load(baseUrl) {
         const data = await fetch(new URL('/api/items', baseUrl)).then((res) => res.json());
         return data.items;
       }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("audit regressions", () => {
  it("does not treat a same-named custom URL producer as an inert object URL", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(api) { const response = await fetch(api.createObjectURL()); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an unresolved bare URL producer as the platform URL API", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(file) { const response = await fetch(createObjectURL(file)); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a custom toDataURL method as a proven canvas producer", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(api) { const response = await fetch(api.toDataURL()); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not preserve inert provenance through a reassigned URL binding", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { let url = "data:text/plain,ok"; url = "/api/data"; const response = await fetch(url); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat shadowed URL and require bindings as bundled asset producers", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(URL, require) {
        const first = await fetch(new URL("/api", baseUrl));
        const second = await fetch(require("/api"));
        return Promise.all([first.json(), second.json()]);
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes the href of a bundled import-meta URL", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const asset = new URL("./font.woff", import.meta.url); const response = await fetch(asset.href); return response.arrayBuffer(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat an absolute import-meta URL as a bundled relative asset", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch(new URL("/api/data", import.meta.url)); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a status guard rather than a status read", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flag) { const response = await fetch("/api"); if (flag) console.log(response.ok); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `if (response.ok) console.log("ok");`,
    `if (!response.ok) console.log("failed");`,
    `response.ok ? console.log("ok") : console.log("failed");`,
    `response.ok && console.log("ok");`,
  ])("does not treat a non-terminating status condition as a guard: %s", (statusRead) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); ${statusRead} return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a positive status branch whose alternate terminates", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); if (response.ok) console.log("ok"); else throw new Error("failed"); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a successful-response exit as guarding the failure fallthrough", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); if (response.ok) return; return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `if (!response.ok) return response.json(); return null;`,
    `if (response.status) return response.json(); return null;`,
  ])("allows consuming a response on either checked status outcome: %s", (body) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); ${body} }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    [`if (response.ok && flag) return response.json(); return null;`, 0],
    [`if (flag && response.ok) return response.json(); return null;`, 0],
    [`if (response.ok || flag) return response.json(); return null;`, 0],
    [`if (flag || response.ok) return response.json(); return null;`, 1],
    [`if (response.ok && flag) return null; return response.json();`, 1],
    [`if (flag && response.ok) return null; return response.json();`, 1],
    [`if (response.ok || flag) return null; return response.json();`, 1],
    [`if (flag || response.ok) return null; return response.json();`, 1],
  ])("tracks short-circuit status evaluation: %s", (body, diagnosticCount) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flag) { const response = await fetch("/api"); ${body} }`,
    );
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it("allows a status switch case that consumes the response", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); switch (response.status) { case 200: return response.json(); default: return null; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a non-terminating status switch as a guard", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); switch (response.status) { case 200: console.log("ok"); } return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a do-while condition as guarding the first consumption", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); do { await response.json(); } while (response.ok); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [`if (flag ? response.ok : true) return response.json(); return null;`, 1],
    [`if (response.ok ? flag : false) return response.json(); return null;`, 0],
    [`if (check?.(response.ok)) return response.json(); return null;`, 1],
    [`if (check?.(response.ok)) return null; return response.json();`, 1],
  ])("tracks conditional and optional status evaluation: %s", (body, diagnosticCount) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flag, check) { const response = await fetch("/api"); ${body} }`,
    );
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it("recognizes a status check duplicated across both conditional branches", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flag) { const response = await fetch("/api"); if (flag ? response.ok : response.ok) return response.json(); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes a status check in the first matching switch case", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); switch (true) { case response.ok: return response.json(); default: return null; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when a guarded first consumption is followed by an unguarded consumption", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); if (response.ok) await response.json(); return response.text(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the failure fallthrough consumes after a successful consumption", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); if (response.ok) return response.json(); return response.text(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["ok", "status"])("does not trust a reassigned destructured %s binding", (key) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); let { ${key} } = response; ${key} = true; if (${key}) return response.json(); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `while (response.ok) { break; } return response.json();`,
    `switch (response.status) { default: break; } return response.json();`,
  ])("does not treat a non-terminating prior control statement as a guard: %s", (body) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); ${body} }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps deeply nested status conditions bounded", () => {
    const condition = Array.from({ length: 25 }, (_, index) => `flags[${index}]`).reduce(
      (nestedCondition, flag, index) =>
        `(${nestedCondition} ${index % 2 === 0 ? "&&" : "||"} ${flag})`,
      "response.ok",
    );
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flags) { const response = await fetch("/api"); if (${condition}) return response.json(); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires a status guard to dominate consumption", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flag) { const response = await fetch("/api"); if (flag && !response.ok) throw new Error("bad"); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a compound status guard when consumption is inside its true branch", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(flag) { const response = await fetch("/api"); if (flag && response.ok) return response.json(); return null; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves the exact response binding", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); { const response = { json: async () => ({}) }; await response.json(); } return 1; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat logging as status validation", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); console.log(response); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer an inert URL from a parameter name", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load(dataUrl) { const response = await fetch(dataUrl); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not mistake a rejection catch for an HTTP status check", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { try { const response = await fetch("/api"); return response.json(); } catch (error) { setError(error); } }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a static computed ok guard", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); if (!response["ok"]) throw new Error(); return response.json(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a static computed body consumer", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function load() { const response = await fetch("/api"); return response["json"](); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
