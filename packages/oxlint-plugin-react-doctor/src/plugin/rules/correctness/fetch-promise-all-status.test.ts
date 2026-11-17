import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchResponseUsedWithoutStatusCheck } from "./no-fetch-response-used-without-status-check.js";

describe("fetch status in a Promise.all tuple", () => {
  it.each([
    [
      "follows a native promise in the adjacent slot",
      `
      const request = fetch("/items");
      const gate = new Promise((resolve) => queueMicrotask(resolve));
      const [response, ready] = await Promise.all([request, gate]);
      return response.json();
    `,
      1,
    ],
    [
      "uses the actual response index and follows readonly aliases",
      `
      const request = fetch("/items");
      const pending = request;
      const [ready, response] = await Promise.all([false, pending]);
      const result = response;
      return result.text();
    `,
      1,
    ],
    [
      "traces inline fetch",
      `
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      1,
    ],
    [
      "still checks the selected response status",
      `
      const request = fetch("/items");
      const [response] = await Promise.all([request, false]);
      if (!response.ok) throw new Error("bad response");
      return response.json();
    `,
      0,
    ],
    [
      "does not use a different fetch slot's status",
      `
      const [first, second] = await Promise.all([fetch("/first"), fetch("/second")]);
      if (!second.ok) throw new Error("bad second response");
      return first.json();
    `,
      1,
    ],
    [
      "does not treat a non-fetch slot as a Response",
      `
      const request = fetch("/items");
      const gate = new Promise((resolve) => resolve(unrelatedResponse));
      const [response, unrelated] = await Promise.all([request, gate]);
      return unrelated.json();
    `,
      0,
    ],
    [
      "ignores an inert URL",
      `
      const [response] = await Promise.all([fetch("data:text/plain,hello")]);
      return response.text();
    `,
      0,
    ],
    [
      "declines a shadowed Promise",
      `
      const Promise = customProvider;
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines a source-visible native mutation",
      `
      Object.defineProperty(Promise, "all", { value: customCollector });
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines escaped Promise aliases",
      `
      const provider = Promise;
      configure(provider);
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines a changed array iterator",
      `
      Array.prototype[Symbol.iterator] = replacement;
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines prototype capabilities passed through destructuring",
      `
      const { getPrototypeOf: getPrototype } = Object;
      getPrototype([])[Symbol.iterator] = replacement;
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines optional collection",
      `
      const [response] = await Promise.all?.([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines spread inputs",
      `
      const [response] = await Promise.all([...prefix, fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines sparse input",
      `
      const [response] = await Promise.all([fetch("/items"), ,]);
      return response.json();
    `,
      0,
    ],
    [
      "declines a mutable input alias",
      `
      let request = fetch("/items");
      request = anotherRequest;
      const [response] = await Promise.all([request]);
      return response.json();
    `,
      0,
    ],
    [
      "declines an escaped input alias",
      `
      const request = fetch("/items");
      rewritePromise(request);
      const [response] = await Promise.all([request]);
      return response.json();
    `,
      0,
    ],
    [
      "declines an array alias",
      `
      const input = [fetch("/items")];
      const [response] = await Promise.all(input);
      return response.json();
    `,
      0,
    ],
    [
      "declines unknown companion slots",
      `
      const [response] = await Promise.all([fetch("/items"), customPromise]);
      return response.json();
    `,
      0,
    ],
    [
      "declines a reassigned result",
      `
      let [response] = await Promise.all([fetch("/items")]);
      response = otherResponse;
      return response.json();
    `,
      0,
    ],
    [
      "declines a defaulted result",
      `
      const [response = otherResponse] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines direct eval that can replace Promise",
      `
      eval("Promise.all = replacement");
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines an object-wrapped Promise capability",
      `
      const holder = { provider: Promise };
      holder.provider.all = replacement;
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines an escaped global capability",
      `
      const holder = { native: globalThis };
      holder.native.Promise.all = replacement;
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "declines computed reflective access to the native iterator",
      `
      Object["get" + "PrototypeOf"]([])[Symbol.iterator] = replacement;
      const [response] = await Promise.all([fetch("/items")]);
      return response.json();
    `,
      0,
    ],
    [
      "does not treat a type-only Promise reference as a capability escape",
      `
      const request: Promise<Response> = fetch("/items");
      const [response] = await Promise.all([request]);
      return response.json();
    `,
      1,
    ],
  ] as const)("%s", (_label, body, expected) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export const load = async () => { ${body} };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
