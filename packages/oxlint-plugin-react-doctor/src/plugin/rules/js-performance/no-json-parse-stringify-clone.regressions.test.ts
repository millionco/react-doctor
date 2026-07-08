import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noJsonParseStringifyClone } from "./no-json-parse-stringify-clone.js";

const expectFail = (code: string): void => {
  const result = runRule(noJsonParseStringifyClone, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noJsonParseStringifyClone, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/no-json-parse-stringify-clone — regressions", () => {
  it("stays silent when round-tripping a caught error before postMessage", () => {
    expectPass(`addEventListener('message', async () => {
      try {
        await upload();
      } catch (err) {
        const errorCloned = { ...JSON.parse(JSON.stringify(err)), message: err?.message };
        postMessage({ result: 'error', error: errorCloned });
      }
    });`);
  });

  it("still flags when a nested function shadows the catch parameter", () => {
    expectFail(`try {
      run();
    } catch (err) {
      const copyOf = (err) => JSON.parse(JSON.stringify(err));
      log(copyOf(otherValue));
    }`);
  });

  it("stays silent inside a *ToJson-named serialization helper", () => {
    expectPass(`function causeToJson(cause) {
      if (typeof cause === "object") {
        return JSON.parse(JSON.stringify(cause));
      }
      return cause;
    }`);
  });

  it("stays silent inside a serialize*-named helper", () => {
    expectPass(`const serializeState = (state) => JSON.parse(JSON.stringify(state));`);
  });

  it("stays silent when the result binds to a normalize*-named variable", () => {
    expectPass(`const formatDate = async ({ date }) => {
      const normalizedDate = JSON.parse(JSON.stringify(date));
      return moment.utc(normalizedDate, ISO_8601_FORMAT, true);
    };`);
  });

  it("still flags a plain deep clone into an ordinary binding", () => {
    expectFail(`const copy = JSON.parse(JSON.stringify(state));`);
  });

  it("still flags a clone of a non-catch value inside a try block", () => {
    expectFail(`try {
      const copy = JSON.parse(JSON.stringify(state));
      use(copy);
    } catch (err) {
      report(err);
    }`);
  });
});
