import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

describe("no-pass-data-to-parent — regressions", () => {
  describe("router / namespaced API receivers", () => {
    it("stays silent on a destructured router prop redirecting in a useEffect (ant-design .dumi/pages/404 shape)", () => {
      const result = runRule(
        noPassDataToParent,
        `const NotFoundPage = ({ router }) => {
          useEffect(() => {
            router.replace(utils.getLocalizedPathname("/", isZhCN(location.pathname)).pathname);
          }, []);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on the member-form router receiver (props.router.replace)", () => {
      const result = runRule(
        noPassDataToParent,
        `const NotFoundPage = (props) => {
          useEffect(() => {
            props.router.replace(utils.getLocalizedPathname("/", true).pathname);
          }, []);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags props.onLoaded(fetchedData) — member-form parent callback", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const fetchedData = useSomeAPI();
          useEffect(() => {
            props.onLoaded(fetchedData);
          }, [props, fetchedData]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags a destructured identifier-form parent callback (onChange(computed))", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = ({ onChange }) => {
          const computed = useSomeAPI();
          useEffect(() => {
            onChange(computed);
          }, [onChange, computed]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("string-read method names on the props object", () => {
    it("still flags props.search(results) — a parent callback named like String.prototype.search", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const results = computeResults();
          useEffect(() => {
            props.search(results);
          }, [props, results]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("stays silent on a string read from a nested prop value (props.path.includes)", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = (props) => {
          const separator = computeSeparator();
          useEffect(() => {
            if (props.path.includes(separator)) {
              console.log("nested");
            }
          }, [props.path, separator]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("stays silent on a string read from a destructured prop value (text.startsWith)", () => {
      const result = runRule(
        noPassDataToParent,
        `const Child = ({ text }) => {
          const computedPrefix = computePrefix();
          useEffect(() => {
            if (text.startsWith(computedPrefix)) {
              console.log("prefixed");
            }
          }, [text, computedPrefix]);
          return null;
        };`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("undefined argument guard", () => {
    it("stays silent on onReset(undefined) — an imperative clear, not data", () => {
      const result = runRule(
        noPassDataToParent,
        `function Child({ onReset }) {
          useEffect(() => {
            onReset(undefined);
          }, [onReset]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an unresolved global identifier argument — pins that the guard matches only the name `undefined`", () => {
      const result = runRule(
        noPassDataToParent,
        `function Child({ onReset }) {
          useEffect(() => {
            onReset(ambientGlobalValue);
          }, [onReset]);
          return null;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  it("still flags handing hook-fetched data back to the parent", () => {
    const result = runRule(
      noPassDataToParent,
      `const Child = ({ onFetched }) => {
        const data = useSomeAPI();
        useEffect(() => {
          onFetched(data);
        }, [onFetched, data]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
