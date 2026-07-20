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

  it("flags the complete Detox element action surface", () => {
    for (const action of [
      "getAttributes()",
      'takeScreenshot("screen")',
      "tapAtPoint({ x: 1, y: 1 })",
      'pinchWithAngle("outward", 45)',
    ]) {
      const result = runRule(rnDetoxMissingAwait, `element(by.id("target")).${action};`, e2eFile);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("flags actions through Detox web elements", () => {
    const result = runRule(rnDetoxMissingAwait, `web.element(by.web.id("target")).tap();`, e2eFile);
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

  it("does not treat undefined as a rejection handler", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `it("x", () => { element(by.id("submit")).tap().then(done, undefined); });`,
      e2eFile,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a done-callback test completed from a fulfillment handler", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `it("handles callbacks", (done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then(() => {
          setTimeout(() => done(), 1000);
        });
      });`,
      e2eFile,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a done callback passed directly to setTimeout", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `it("handles callbacks", (done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then(() => {
          setTimeout(done, 1000);
        });
      });`,
      e2eFile,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes the final done parameter in test.each callbacks", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `test.each([1])("case %s", (value, done) => {
        element(by.id(String(value))).tap().then(done);
      });`,
      e2eFile,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not recurse forever through cyclic rejection-handler aliases", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `it("cyclic aliases", () => {
        const first = second;
        const second = first;
        element(by.id("submit")).tap().then(undefined, first);
      });`,
      e2eFile,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when the fulfillment handler calls a shadowed callback", () => {
    const result = runRule(
      rnDetoxMissingAwait,
      `it("does not complete", (done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then((done) => done());
      });`,
      e2eFile,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires the actual done callback on every fulfillment path", () => {
    const invalidSources = [
      `it("conditional", (done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then(() => {
          if (false) done();
        });
      });`,
      `it("deferred", (done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then(() => () => done());
      });`,
      `it("second parameter", (value, done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then(() => done());
      });`,
      `it("continued after done", (done) => {
        expect(element(by.text("Welcome")))
          .toBeVisible()
          .then(done)
          .then(() => element(by.id("dismiss")).tap());
      });`,
      `it("finalized after done", (done) => {
        expect(element(by.text("Welcome"))).toBeVisible().then(done).finally(cleanup);
      });`,
    ];
    for (const source of invalidSources) {
      expect(runRule(rnDetoxMissingAwait, source, e2eFile).diagnostics).toHaveLength(1);
    }
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
