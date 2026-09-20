import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import {
  CROSS_FILE_BARREL_FOLLOW_DEPTH,
  FUNCTION_RESOLUTION_MAX_DEPTH,
} from "../../constants/thresholds.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

const reader = `
const cache = new WeakMap();
export const read = (key) => {
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = fetchValue(key);
  cache.set(key, promise);
  return promise;
};
export const format = async (key) => {
  const value = await read(key);
  return String(value);
};
`;

const consumer = `
import { read, format } from "./source";
export const load = async (key) => {
  const [value] = await Promise.all([read(key).then(value => value ?? [])]);
  const text = await format(key);
  return [value, text];
};
`;

let directory: string;

const writeFixture = (name: string, source: string): string => {
  const filename = path.join(directory, name);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};

const diagnose = (source = consumer) => {
  const filename = writeFixture("consumer.ts", source);
  const result = runRule(serverSequentialIndependentAwait, source, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "sequential-await-cross-file-"));
  resetFilesystemCaches();
});

afterEach(() => {
  resetFilesystemCaches();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("server-sequential-independent-await cross-file cache evidence", () => {
  it("connects an imported formatter to a guarded shared cache reader", () => {
    writeFixture("source.ts", reader);
    expect(diagnose()).toEqual([]);
  });

  it("supports the derived-key and early-return shape from React Grab", () => {
    writeFixture(
      "source.ts",
      reader
        .replace(
          "const cached = cache.get(key);",
          "if (!enabled()) return Promise.resolve([]); const resolved = resolveElement(key); const cached = cache.get(resolved);",
        )
        .replace("cache.set(key, promise)", "cache.set(resolved, promise)"),
    );
    expect(diagnose()).toEqual([]);
  });

  it("supports synchronous formatting after the shared cache read", () => {
    writeFixture(
      "source.ts",
      `
      ${reader.replace(
        "return String(value);",
        `
        if (value) return render(value);
        const names = getNames(key);
        return names.map(name => name.toUpperCase()).join("");
      `,
      )}
      const render = (value): string => opaqueFormatter(value);
      const getNames = (key): string[] => opaqueNames(key);
    `,
    );
    expect(diagnose()).toEqual([]);
  });

  it("follows aliases, namespace members, barrels and a second imported wrapper", () => {
    writeFixture("cache.ts", reader);
    writeFixture(
      "format.ts",
      `
      import { read as lookup } from "./cache";
      export const format = async (key) => {
        const result = await lookup(key);
        return String(result);
      };
    `,
    );
    writeFixture("source.ts", 'export { read } from "./cache"; export { format } from "./format";');
    expect(
      diagnose(`
      import * as source from "./source";
      import { format as formatValue } from "./source";
      const sourceAlias = source;
      async function load(key) {
        const first = await sourceAlias["read"](key);
        const second = await formatValue(key);
        return [first, second];
      }
    `),
    ).toEqual([]);
  });

  it("resolves default exports through configured aliases", () => {
    writeFixture(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@cache/*": ["lib/*"] } },
      }),
    );
    writeFixture("lib/cache.ts", `${reader}\nexport default read;`);
    writeFixture(
      "source.ts",
      `
      import lookup from "@cache/cache";
      export { default as read } from "@cache/cache";
      export const format = async key => {
        const value = await lookup(key);
        return String(value);
      };
    `,
    );
    expect(diagnose()).toEqual([]);
  });

  it.each([
    ["fresh work", reader.replace("if (cached) return cached;", "if (cached) consume(cached);")],
    [
      "different cache write key",
      reader.replace("cache.set(key, promise)", "cache.set(other, promise)"),
    ],
    ["cache invalidation", `${reader}\nexport const invalidate = key => cache.delete(key);`],
    ["escaping cache", `${reader}\nexport { cache };`],
    ["replaced cache method", `${reader}\ncache.get = key => fetchValue(key);`],
    ["unconditional cache overwrite", reader.replace("if (cached) return cached;", "")],
    [
      "invocation-local cache",
      reader
        .replace("const cache = new WeakMap();", "")
        .replace(
          "export const read = (key) => {",
          "export const read = (key) => { const cache = new WeakMap();",
        ),
    ],
    ["shadowed WeakMap", `const WeakMap = CustomCache;\n${reader}`],
    [
      "fresh cache key",
      reader
        .replace(
          "const cached = cache.get(key);",
          "const fresh = { key }; const cached = cache.get(fresh);",
        )
        .replace("cache.set(key, promise)", "cache.set(fresh, promise)"),
    ],
    ["optional cache lookup", reader.replace("await read(key)", "await read?.(key)")],
    ["different arguments", reader.replace("await read(key)", "await read(other)")],
    [
      "additional independent await",
      reader.replace("return String(value);", "const other = await fetch('/fresh'); return other;"),
    ],
    [
      "returned independent request",
      reader.replace("return String(value);", "return fetch('/fresh');"),
    ],
    [
      "returned client request",
      reader.replace("return String(value);", "return client.request(key);"),
    ],
    ["unknown join method", reader.replace("return String(value);", "return client.join(key);")],
    [
      "additional awaited promise",
      reader.replace("return String(value);", "return await pending;"),
    ],
    [
      "returned local request",
      `${reader.replace("return String(value);", "return request(key);")}\nconst request = key => fetch('/fresh/' + key);`,
    ],
    [
      "deferred cache access",
      reader.replace(
        "const value = await read(key);",
        "const later = () => read(key); const value = await fetch('/fresh');",
      ),
    ],
    [
      "same fresh imported operation",
      `
      export const read = key => fetch('/fresh/' + key);
      export const format = async key => read(key);
    `,
    ],
    [
      "recursive imports",
      `
      import { format as again } from "./cycle";
      export const read = key => again(key);
      export const format = async key => again(key);
    `,
    ],
    [
      "mutable exported reader",
      `${reader.replace("export const read", "export let read")}\nread = fetchValue;`,
    ],
    [
      "reassigned formatter",
      `${reader.replace("export const format", "export let format")}\nformat = fetchValue;`,
    ],
    [
      "additional imported request",
      `
      import { request } from "./request";
      ${reader.replace("return String(value);", "return request(key);")}
    `,
    ],
    ["malformed module", "export const read = ("],
  ])("retains the warning for %s", (_name, source) => {
    writeFixture("source.ts", source);
    writeFixture("cycle.ts", 'export { format } from "./source";');
    writeFixture("request.ts", "export const request = key => fetch('/request/' + key);");
    expect(diagnose()).toHaveLength(1);
  });

  it("does not connect independent imported requests with the same argument", () => {
    writeFixture(
      "source.ts",
      `
      export const getUser = id => fetch('/users/' + id);
      export const getPermissions = id => fetch('/permissions/' + id);
    `,
    );
    expect(
      diagnose(`
      import { getUser, getPermissions } from "./source";
      async function load(id) {
        const user = await getUser(id);
        const permissions = await getPermissions(id);
        return [user, permissions];
      }
    `),
    ).toHaveLength(1);
  });

  it("keeps unresolved imports conservative", () => {
    expect(diagnose()).toHaveLength(1);
  });

  it("does not conflate separate caches in different modules", () => {
    writeFixture("first.ts", reader);
    writeFixture("second.ts", reader);
    writeFixture("source.ts", 'export { read } from "./first"; export { format } from "./second";');
    expect(diagnose()).toHaveLength(1);
  });

  it("rejects ambiguous star re-exports", () => {
    writeFixture("first.ts", reader);
    writeFixture("second.ts", reader);
    writeFixture("source.ts", 'export * from "./first"; export * from "./second";');
    expect(diagnose()).toHaveLength(1);
  });

  it("stops at the existing barrel and function-resolution bounds", () => {
    writeFixture("source.ts", 'export * from "./barrel-0";');
    for (let index = 0; index < CROSS_FILE_BARREL_FOLLOW_DEPTH; index++) {
      writeFixture(`barrel-${index}.ts`, `export * from "./barrel-${index + 1}";`);
    }
    writeFixture(`barrel-${CROSS_FILE_BARREL_FOLLOW_DEPTH}.ts`, reader);
    expect(diagnose()).toHaveLength(1);

    writeFixture(
      "source.ts",
      'export { read } from "./cache"; export { format } from "./wrapper-0";',
    );
    writeFixture("cache.ts", reader);
    for (let index = 0; index < FUNCTION_RESOLUTION_MAX_DEPTH; index++) {
      writeFixture(
        `wrapper-${index}.ts`,
        `
        import { format as next } from "./wrapper-${index + 1}";
        export const format = async key => await next(key);
      `,
      );
    }
    writeFixture(
      `wrapper-${FUNCTION_RESOLUTION_MAX_DEPTH}.ts`,
      'export { format } from "./cache";',
    );
    resetFilesystemCaches();
    expect(diagnose()).toHaveLength(1);
  });

  it("records transitive content and missing-module probes for sidecar invalidation", () => {
    const cachePath = writeFixture("cache.ts", reader);
    const sourcePath = writeFixture("source.ts", 'export { read, format } from "./cache";');
    const filename = writeFixture("consumer.ts", consumer);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["server-sequential-independent-await"],
    });
    expect(trace?.contentPaths).toContain(cachePath);
    expect(trace?.contentPaths).toContain(sourcePath);
    expect(diagnose()).toEqual([]);

    writeFixture("cache.ts", reader.replace("if (cached) return cached;", ""));
    expect(diagnose()).toHaveLength(1);

    fs.unlinkSync(sourcePath);
    resetFilesystemCaches();
    const missingTrace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["server-sequential-independent-await"],
    });
    expect(missingTrace?.existencePaths).toContain(sourcePath);
    expect(diagnose()).toHaveLength(1);
  });
});
