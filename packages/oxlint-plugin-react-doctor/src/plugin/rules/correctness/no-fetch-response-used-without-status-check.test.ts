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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet when a .catch link materializes the failure with a fallback value", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `fetch(url)
         .then((response) => response.json())
         .then((posts) => setPosts(posts))
         .catch(() => setPosts([]));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a two-arg .then routes rejections into error state", () => {
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

  it("stays quiet when an enclosing try/catch surfaces the failure as error state", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet when an awaited .then chain sits in a try whose catch materializes the failure", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet: dataUrlToBlob helper taking the data URL as a parameter", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Effect fetch via inner async load() with load().catch() materializing into error state", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Promise.all of .then(json) chains inside a try whose catch materializes", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: Promise.race timeout wrapper inside a materializing try/catch", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet when the status is checked on the parsed body (status-in-body API)", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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

  it("stays quiet when an enclosing try has a deliberately empty fail-open catch", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when a consuming chain ends in a deliberately empty .catch swallow", () => {
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
    expect(result.diagnostics).toHaveLength(0);
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
