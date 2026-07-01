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
});
