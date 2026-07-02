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
});
