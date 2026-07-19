import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnDetoxMissingAwait } from "./rn-detox-missing-await.js";

const e2eFile = { filename: "e2e/login.e2e.ts" };

describe("rn-detox-missing-await", () => {
  it("flags an un-awaited element action", () => {
    const code = `it("x", async () => { element(by.id("submit")).tap(); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("await");
  });

  it("flags an un-awaited waitFor chain", () => {
    const code = `it("x", async () => { waitFor(element(by.id("x"))).toBeVisible().withTimeout(2000); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an un-awaited expect(element(...)) assertion", () => {
    const code = `it("x", async () => { expect(element(by.id("title"))).toBeVisible(); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an un-awaited typeText on a matcher chain", () => {
    const code = `it("x", async () => { element(by.id("input")).atIndex(0).typeText("hi"); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag awaited actions", () => {
    const code = `it("x", async () => { await element(by.id("submit")).tap(); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag awaited expect", () => {
    const code = `it("x", async () => { await expect(element(by.id("title"))).toBeVisible(); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a returned action", () => {
    const code = `const step = () => element(by.id("submit")).tap();`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an action with only a fulfillment handler", () => {
    const code = `it("x", () => { element(by.id("submit")).tap().then(done); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an action with an explicit rejection handler", () => {
    const code = `it("x", () => { element(by.id("submit")).tap().then(done, fail); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an action followed only by finally", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `it("x", async () => { element(by.id("submit")).tap().finally(cleanup); });`,
      { filename: "e2e/login.e2e.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag locally shadowed Detox globals", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `const element = (selector) => ({ tap: () => undefined });
       it("x", () => { element("submit").tap(); });`,
      { filename: "e2e/local.e2e.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags actions through an explicit Detox import", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `import { by, element } from "detox";
       it("x", async () => { element(by.id("submit")).tap(); });`,
      { filename: "e2e/imported.e2e.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag matcher construction assigned to a variable", () => {
    const code = `it("x", async () => { const el = element(by.id("submit")); await el.tap(); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an element() passed as a multiline argument", () => {
    const code = `
      it("x", async () => {
        await waitFor(
          element(by.id("scrollview")),
        ).toBeVisible().withTimeout(1000);
      });
    `;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an un-awaited action whose element() receiver is wrapped in `as any`", () => {
    const code = `it("x", async () => { (element(by.id("submit")) as any).tap(); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a Jest expect(value) assertion", () => {
    const code = `it("x", () => { expect(value).toBe(3); });`;
    const result = runRule(rnDetoxMissingAwait, code, e2eFile);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT run outside Detox test files", () => {
    const code = `element(by.id("submit")).tap();`;
    const result = runRule(rnDetoxMissingAwait, code, { filename: "src/screens/Home.tsx" });
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("audit regressions", () => {
  it("flags an action followed by an empty then", () => {
    const result = runRule(rnDetoxMissingAwait, `element(by.id("x")).tap().then();`, {
      filename: "test.e2e.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an explicitly voided action", () => {
    const result = runRule(rnDetoxMissingAwait, `void element(by.id("x")).tap();`, {
      filename: "test.e2e.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves aliased Detox imports", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `import { element as detoxElement, by } from "detox"; detoxElement(by.id("x")).tap();`,
      { filename: "test.e2e.ts" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
