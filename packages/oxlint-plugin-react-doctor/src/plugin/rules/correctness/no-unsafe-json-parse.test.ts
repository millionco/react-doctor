import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafeJsonParse } from "./no-unsafe-json-parse.js";

describe("no-unsafe-json-parse", () => {
  it("flags immediate member access on the parse result", () => {
    const result = runRule(noUnsafeJsonParse, `const m = JSON.parse(raw).foo;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained member access on the parse result", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const m = JSON.parse(schedule.api_response).error.message;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags member access through parentheses", () => {
    const result = runRule(noUnsafeJsonParse, `const m = (JSON.parse(raw)).foo;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a network-text parse dereference outside try", () => {
    const result = runRule(noUnsafeJsonParse, `const id = JSON.parse(networkText).id;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags object destructuring straight off the parse result", () => {
    const result = runRule(noUnsafeJsonParse, `const { foo } = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags array destructuring straight off the parse result", () => {
    const result = runRule(noUnsafeJsonParse, `const [first] = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a parse dereference in a handler merely defined inside a try block", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `
      try {
        socket.onmessage = (event) => setItems(JSON.parse(event.data).items);
      } catch (error) {
        handle(error);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a bare assignment with no member access", () => {
    const result = runRule(noUnsafeJsonParse, `const data = JSON.parse(raw);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse/stringify round-trip clone", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const copy = JSON.parse(JSON.stringify(value)).foo;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse dereference inside an enclosing try block", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `try { const m = JSON.parse(raw).foo; } catch (error) { handle(error); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a synchronous array-callback parse inside an enclosing try block", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `
      try {
        const values = items.map((item) => JSON.parse(item).value);
      } catch (error) {
        handle(error);
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag object destructuring inside an enclosing try block", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `try { const { foo } = JSON.parse(raw); } catch (error) { handle(error); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag destructuring when the result is annotated with an as-cast", () => {
    const result = runRule(noUnsafeJsonParse, `const { foo } = JSON.parse(raw) as Payload;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result is annotated with an as-cast", () => {
    const result = runRule(noUnsafeJsonParse, `const m = (JSON.parse(raw) as Payload).error;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the result is wrapped in a validator", () => {
    const result = runRule(noUnsafeJsonParse, `const parsed = schema.parse(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse passed as a call argument", () => {
    const result = runRule(noUnsafeJsonParse, `doThing(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `?? "{}"` fallback argument', () => {
    const result = runRule(noUnsafeJsonParse, `const value = JSON.parse(input ?? "{}").value;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a `|| "[]"` fallback argument', () => {
    const result = runRule(noUnsafeJsonParse, `const length = JSON.parse(input || "[]").length;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when JSON is shadowed by a local binding", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `
      function read(raw) {
        const JSON = { parse: () => ({ value: 1 }) };
        return JSON.parse(raw).value;
      }
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse dereference inside a test file", () => {
    const result = runRule(noUnsafeJsonParse, `const m = JSON.parse(raw).foo;`, {
      filename: "payload.test.ts",
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a statically valid string-literal argument", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const { version } = JSON.parse('{"version":"1.0.0","features":[]}');`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the stringify-clone idiom through a binding", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const snapshot = JSON.stringify(state);
      const { items } = JSON.parse(snapshot);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CommonJS release script parsing tool output (react-tooltip shape)", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const util = require("util");
      const exec = util.promisify(require("child_process").exec);
      const autoBetaRelease = async () => {
        const { stdout } = await runCommand("npm view . versions --json");
        return JSON.parse(stdout).filter((version) => version.includes("beta"));
      };`,
      { filename: "beta-release.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a CommonJS token-generation script reading a repo-local file (vip-design-system shape)", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const fs = require("fs");
      const colorsData = fs.readFileSync("colors.json");
      const allColors = JSON.parse(colorsData).color;`,
      { filename: "tokens/utilities/colors/index.js" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a parse destructure in ESM code importing node builtins (renoun shape)", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `import { readFile } from "node:fs/promises";
      export const findPackageDependency = async (packageJsonPath) => {
        const packageJsonContent = await readFile(packageJsonPath, "utf-8");
        const { dependencies = {} } = JSON.parse(packageJsonContent);
        return dependencies;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a deserializer paired with a same-module stringify serializer (audius shape)", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `export const serializeKeyPair = (value) => {
        const { publicKey, secretKey } = value;
        return JSON.stringify({ publicKey: encode(publicKey), secretKey: encode(secretKey) });
      };
      export const deserializeKeyPair = (value) => {
        const { publicKey, secretKey } = JSON.parse(value);
        return { publicKey: decode(publicKey), secretKey: decode(secretKey) };
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a deserialize function with no same-module serializer", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `export const deserializeSettings = (value) => {
        const { theme } = JSON.parse(value);
        return theme;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a re-parse dominated by an unconditional prior parse of the same string (glific shape)", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `function setStates(translationsVal, language) {
        if (translationsVal) {
          const translationsCopy = JSON.parse(translationsVal);
          if (Object.keys(translationsCopy).length > 0) {
            return JSON.parse(translationsVal)[language.id];
          }
        }
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a re-parse whose prior parse only runs conditionally", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `function read(raw, key) {
        if (shouldValidate) {
          JSON.parse(raw);
        }
        return JSON.parse(raw)[key];
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags sibling switch-case parses that do not dominate each other (glific AuthService shape)", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `export const getAuthSession = (element) => {
        const session = localStorage.getItem("glific_session");
        if (!session) return null;
        switch (element) {
          case "renewal_token":
            return JSON.parse(session).renewal_token;
          default:
            return JSON.parse(session).access_token;
        }
      };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });
});
