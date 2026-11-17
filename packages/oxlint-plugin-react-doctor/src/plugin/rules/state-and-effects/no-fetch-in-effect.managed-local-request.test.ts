import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

const sharedRequest = `
  const pendingByAddress = new Map<string, Promise<string>>();
  const readSummary = (address: string) => {
    const ongoing = pendingByAddress.get(address);
    if (ongoing) return ongoing;
    const work = fetch(address).then((reply) => reply.text()).catch(() => "");
    pendingByAddress.set(address, work);
    return work;
  };
`;

const guardedSubscription = `
  let ignore = false;
  void readSummary(address).then((value) => {
    if (!ignore) setSummary(value);
  });
  return () => { ignore = true; };
`;

const snippet = (
  helper = sharedRequest,
  subscription = guardedSubscription,
  additionalSource = "",
): string => `
  import { useEffect, useState } from "react";
  ${helper}
  const useSummary = (address: string) => {
    const [summary, setSummary] = useState("");
    useEffect(() => { ${subscription} }, [address]);
    return summary;
  };
  ${additionalSource}
`;

const expectCount = (source: string, expectedCount: number): void => {
  const result = runRule(noFetchInEffect, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("no-fetch-in-effect managed local requests", () => {
  it("recognizes a private shared request and an owned guarded subscriber", () => {
    expectCount(snippet(), 0);
  });

  it.each([
    "const readSummary = (address: string) => fetch(address).then((reply) => reply.text());",
    `const readSummary = (address: string) => {
      const work = fetch(address).then((reply) => reply.json());
      return work;
    };`,
    "const readSummary = (address: string) => fetch(address);",
    `function readSummary(address: string) {
      return fetch(address).then((reply) => reply.text()).catch(() => "");
    }`,
  ])("recognizes an exact returned request helper", (helper) => {
    expectCount(snippet(helper), 0);
  });

  it("uses binding identity rather than a cancellation variable name", () => {
    expectCount(snippet(sharedRequest, guardedSubscription.replaceAll("ignore", "withdrawn")), 0);
  });

  it("supports a direct expression cleanup", () => {
    expectCount(
      snippet(
        sharedRequest,
        guardedSubscription.replace("() => { ignore = true; }", "() => ignore = true"),
      ),
      0,
    );
  });

  it("requires a synchronous effect to register the cleanup", () => {
    expectCount(snippet().replace("useEffect(() =>", "useEffect(async () =>"), 1);
  });

  it("supports a direct inline function expression", () => {
    expectCount(snippet().replace("useEffect(() =>", "useEffect(function ()"), 0);
  });

  it.each(["return setup;", "return summary;"])(
    "does not certify a named setup callback with %s",
    (returned) => {
      const source = snippet(
        "const readSummary = (address) => fetch(address).then((reply) => reply.text());",
      )
        .replace("useEffect(() => {", "const setup = () => {")
        .replace("}, [address]);", "}; useEffect(setup, [address]);")
        .replace("return summary;", returned);
      expectCount(source, 1);
    },
  );

  it("does not certify a setter exposed through native request input coercion", () => {
    const source = snippet(
      "const readSummary = (address) => fetch(address).then((reply) => reply.text());",
    )
      .replace("useEffect(() =>", "const input = { toString: setSummary }; useEffect(() =>")
      .replace("readSummary(address)", "readSummary(input)")
      .replace("[address]);", "[input]);");
    expectCount(source, 1);
  });

  it.each([
    ["a local alias", "const publish = setSummary; useEffect(() =>", "return summary;"],
    [
      "an object property",
      "const holder = { publish: setSummary }; useEffect(() =>",
      "return summary;",
    ],
    ["a returned setter", "useEffect(() =>", "return [summary, setSummary];"],
  ])("does not certify a setter escaping through %s", (_name, setup, returned) => {
    const source = snippet().replace("useEffect(() =>", setup).replace("return summary;", returned);
    expectCount(source, 1);
  });

  it("does not certify an exported default helper", () => {
    expectCount(
      snippet("export default function readSummary(address: string) { return fetch(address); }"),
      1,
    );
  });

  it.each([
    ["unguarded completion", guardedSubscription.replace("if (!ignore) ", "")],
    ["wrong polarity", guardedSubscription.replace("!ignore", "ignore")],
    ["missing cleanup", guardedSubscription.replace("ignore = true", "ignore = false")],
    [
      "reset after cleanup",
      guardedSubscription.replace("ignore = true;", "ignore = true; ignore = false;"),
    ],
    [
      "reset before completion",
      guardedSubscription.replace("if (!ignore)", "ignore = false; if (!ignore)"),
    ],
    [
      "suspension after the guard",
      guardedSubscription
        .replace("(value) =>", "async (value) =>")
        .replace("setSummary(value);", "{ await pause(); setSummary(value); }"),
    ],
    [
      "unguarded catch",
      guardedSubscription.replace("});", '}).catch(() => setSummary("failed"));'),
    ],
    [
      "unguarded finally",
      guardedSubscription.replace("});", '}).finally(() => setSummary("done"));'),
    ],
    ["unowned setter", guardedSubscription.replace("setSummary(value)", "publish(value)")],
    [
      "updater callback",
      guardedSubscription.replace("setSummary(value)", "setSummary(() => value)"),
    ],
    [
      "another launched request",
      guardedSubscription.replace("let ignore", "void fetch(address); let ignore"),
    ],
  ])("retains the warning for %s", (_name, subscription) => {
    expectCount(snippet(sharedRequest, subscription), 1);
  });

  it.each([
    [
      "unrelated returned promise",
      sharedRequest.replace("return work;", 'return Promise.resolve("other");'),
    ],
    [
      "hidden helper writer",
      sharedRequest.replace("reply.text()", "{ publish(reply); return reply.text(); }"),
    ],
    [
      "hidden catch writer",
      sharedRequest.replace('.catch(() => "")', '.catch(() => { publish(); return ""; })'),
    ],
    [
      "hidden finally writer",
      sharedRequest.replace('.catch(() => "")', ".finally(() => publish())"),
    ],
    ["opaque response callback", sharedRequest.replace("(reply) => reply.text()", "convertReply")],
    ["mutable helper", sharedRequest.replace("const readSummary", "let readSummary")],
    ["different lookup key", sharedRequest.replace(".get(address)", '.get("other")')],
    [
      "different insertion key",
      sharedRequest.replace(".set(address, work)", '.set("other", work)'),
    ],
    [
      "different inserted promise",
      sharedRequest.replace(".set(address, work)", '.set(address, Promise.resolve("other"))'),
    ],
    [
      "cache constructor arguments",
      sharedRequest.replace("new Map<string, Promise<string>>()", "new Map(existing)"),
    ],
    ["mutable returned promise", sharedRequest.replace("const work", "let work")],
    [
      "additional helper request",
      sharedRequest.replace("const work", "void fetch(address); const work"),
    ],
  ])("retains the warning for %s", (_name, helper) => {
    expectCount(snippet(helper), 1);
  });

  it.each([
    ["cache alias escape", "const escaped = pendingByAddress;"],
    ["cache argument escape", "consume(pendingByAddress);"],
    ["cache export", "export { pendingByAddress };"],
    ["cache default export", "export default pendingByAddress;"],
    ["helper export", "export { readSummary };"],
    ["helper argument escape", "consume(readSummary);"],
    ["cache mutation", "pendingByAddress.clear();"],
    ["cache method overwrite", "pendingByAddress.get = () => undefined;"],
    ["native Map method overwrite", "Map.prototype.set = otherSet;"],
    ["native fetch replacement", "globalThis.fetch = otherFetch;"],
    ["native Promise overwrite", "Promise.prototype.then = otherThen;"],
    ["provider mutation", 'Object.defineProperty(Map.prototype, "get", { value: otherGet });'],
    ["dynamic provider code", "eval(providerCode);"],
    ["dynamic imported provider", 'void import("provider");'],
    ["unresolved provider call", "changeProvider();"],
    ["provider reexport", 'export * from "provider";'],
  ])("retains the warning for %s", (_name, additionalSource) => {
    expectCount(snippet(sharedRequest, guardedSubscription, additionalSource), 1);
  });

  it("does not treat an imported fetch provider as native", () => {
    expectCount(
      snippet().replace("import { useEffect", 'import { fetch } from "client"; import { useEffect'),
      1,
    );
  });

  it("does not treat a shadowed Map constructor as native", () => {
    expectCount(snippet(`class Map { get() {} set() {} } ${sharedRequest}`), 1);
  });

  it("does not treat a local useState provider as React", () => {
    expectCount(
      snippet().replace(
        'import { useEffect, useState } from "react";',
        'import { useEffect } from "react"; const useState = factory;',
      ),
      1,
    );
  });

  it("does not hide a shadowing subscriber setter", () => {
    expectCount(
      snippet(
        sharedRequest,
        guardedSubscription.replace("(value) => {", "(value) => { const setSummary = publish;"),
      ),
      1,
    );
  });
});
