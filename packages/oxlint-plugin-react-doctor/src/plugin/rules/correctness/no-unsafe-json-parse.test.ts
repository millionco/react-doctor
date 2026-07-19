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

  it("flags destructuring when the result is only annotated with an as-cast", () => {
    const result = runRule(noUnsafeJsonParse, `const { foo } = JSON.parse(raw) as Payload;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags member access when the result is only annotated with an as-cast", () => {
    const result = runRule(noUnsafeJsonParse, `const m = (JSON.parse(raw) as Payload).error;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a static computed parse spelling", () => {
    const result = runRule(noUnsafeJsonParse, `const m = JSON["parse"](raw).foo;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when the result is wrapped in a validator", () => {
    const result = runRule(noUnsafeJsonParse, `const parsed = schema.parse(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse passed as a call argument", () => {
    const result = runRule(noUnsafeJsonParse, `doThing(JSON.parse(raw));`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('flags a `?? "{}"` fallback because malformed non-null input can still throw', () => {
    const result = runRule(noUnsafeJsonParse, `const value = JSON.parse(input ?? "{}").value;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags a `|| "[]"` fallback because malformed truthy input can still throw', () => {
    const result = runRule(noUnsafeJsonParse, `const length = JSON.parse(input || "[]").length;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a dynamic fallback whose JSON validity is unknown", () => {
    const result = runRule(noUnsafeJsonParse, `const value = JSON.parse(input ?? fallback).value;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an invalid static fallback", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const value = JSON.parse(input ?? "missing").value;`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag an ESM build script reading its local package manifest", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `import * as fs from "node:fs"; const { name } = JSON.parse(fs.readFileSync("package.json", "utf8"));`,
      { filename: "build.mjs" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an ESM build script when its filename is absolute", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `import * as fs from "node:fs"; const { name } = JSON.parse(fs.readFileSync("package.json", "utf8"));`,
      { filename: "/workspace/packages/ui/build.mjs" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse of a value returned by a serializer-named helper", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `import { getTrendDatasetKey } from "./utils"; const key = getTrendDatasetKey(dataset); const value = JSON.parse(key).breakdown_value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parse dominated by a local try-catch JSON validator", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const isValidJsonArray = (value) => { try { return Array.isArray(JSON.parse(value)); } catch { return false; } };
      function format(value) { if (typeof value === "string" && isValidJsonArray(value)) { const [first] = JSON.parse(value); return first; } return null; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("preserves local JSON validation through nan normalization", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const isValidJsonArray = (value) => { try { return Array.isArray(JSON.parse(value)); } catch { return false; } };
      function format(value) { if (isValidJsonArray(value)) { const normalized = value.replace(/\\bnan\\b/g, "null"); const [first] = JSON.parse(normalized); return first; } return null; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags runtime input in a CommonJS application that also requires a builtin", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const fs = require("fs"); const value = JSON.parse(request.body).value;`,
      { filename: "server.js" },
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("still flags a re-parse after the source binding is reassigned", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `function read(raw) { JSON.parse(raw); raw = getNextPayload(); return JSON.parse(raw).value; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags when a prior parse only parsed a shadowed binding with the same name", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `function read(raw) {
        { const raw = "{}"; JSON.parse(raw); }
        return JSON.parse(raw).value;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a parse dereference in an event callback registered inside try", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `try {
        button.addEventListener("click", () => JSON.parse(raw).value);
      } catch (error) { handle(error); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags behind a validator that parses a different binding", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const isValidJson = (value) => { try { JSON.parse(knownGood); return true; } catch { return false; } };
      if (isValidJson(raw)) { JSON.parse(raw).value; }`,
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

  it("does not trust a validator inside a disjunction", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const validJson = (value) => { try { JSON.parse(value); return true; } catch { return false; } }; if (validJson(raw) || enabled) use(JSON.parse(raw).id);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires the validating parse and false return to belong to the same try/catch", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const validJson = (value) => { try { JSON.parse(value); } catch { recover(); } try { work(); return true; } catch { return false; } }; if (validJson(raw)) use(JSON.parse(raw).id);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a validator with a truthy path that bypasses parsing", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const validJson = (value, enabled) => { try { if (enabled) return true; JSON.parse(value); return true; } catch { return false; } }; if (validJson(raw, enabled)) use(JSON.parse(raw).id);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a deferred write invalidate a prior parse proof", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `JSON.parse(raw); const later = () => { raw = other; }; use(JSON.parse(raw).id);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a property read from a statically parsed null", () => {
    const result = runRule(noUnsafeJsonParse, `const value = JSON.parse("null").value;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates a JSON validator guard after reassignment", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const isValidJsonArray = (value) => { try { return Array.isArray(JSON.parse(value)); } catch { return false; } };
      function format(value) {
        if (isValidJsonArray(value)) {
          value = readPayload();
          return JSON.parse(value)[0];
        }
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("invalidates a serializer-derived binding after reassignment", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `let snapshot = JSON.stringify(state);
      snapshot = readPayload();
      const value = JSON.parse(snapshot).value;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps Array.from mapper parses protected by an outer try", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `try { Array.from(values, () => JSON.parse(raw).value); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a shadowed Array.from callback as synchronous", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `const Array = { from: (values, callback) => queueMicrotask(() => values.map(callback)) };
      try { Array.from(values, () => JSON.parse(raw).value); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let an outer try suppress a custom async-map parse", () => {
    const result = runRule(
      noUnsafeJsonParse,
      `try { asyncMap(values, () => JSON.parse(raw).value); } catch { recover(); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
