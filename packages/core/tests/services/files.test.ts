import * as Effect from "effect/Effect";
import { describe, expect, it } from "vite-plus/test";
import { Files } from "../../src/services/files.js";

const runWithLayer = <A>(
  layer: ReturnType<typeof Files.layerInMemory>,
  program: Effect.Effect<A, never, Files>,
): Promise<A> => Effect.runPromise(program.pipe(Effect.provide(layer)));

describe("Files.layerInMemory", () => {
  const tree = new Map<string, string>([
    ["/repo/src/index.ts", "import {foo} from './foo';\nexport const a = 1;\n"],
    ["/repo/src/foo.ts", "export const foo = 42;\n"],
  ]);

  it("readLines returns the file contents split by newline", async () => {
    const lines = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.readLines({
          filePath: "/repo/src/index.ts",
          rootDirectory: "/repo",
        });
      }),
    );
    expect(lines).toEqual(["import {foo} from './foo';", "export const a = 1;", ""]);
  });

  it("readLines resolves relative paths against rootDirectory", async () => {
    const lines = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.readLines({ filePath: "src/index.ts", rootDirectory: "/repo" });
      }),
    );
    expect(lines).not.toBeNull();
    expect((lines as string[]).length).toBeGreaterThan(0);
  });

  it("readLines returns null when the path is absent", async () => {
    const lines = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.readLines({
          filePath: "/repo/src/missing.ts",
          rootDirectory: "/repo",
        });
      }),
    );
    expect(lines).toBeNull();
  });

  it("listSourceFiles returns relative paths under the root", async () => {
    const result = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.listSourceFiles("/repo");
      }),
    );
    expect([...result].toSorted()).toEqual(["src/foo.ts", "src/index.ts"]);
  });

  it("isFile returns true only for present paths", async () => {
    const present = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.isFile("/repo/src/index.ts");
      }),
    );
    const absent = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.isFile("/repo/src/missing.ts");
      }),
    );
    expect(present).toBe(true);
    expect(absent).toBe(false);
  });

  it("isDirectory returns true when any descendant exists", async () => {
    const dir = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.isDirectory("/repo/src");
      }),
    );
    const notDir = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.isDirectory("/other");
      }),
    );
    expect(dir).toBe(true);
    expect(notDir).toBe(false);
  });

  it("isDirectory returns false for a path that exists as a file", async () => {
    const result = await runWithLayer(
      Files.layerInMemory(tree),
      Effect.gen(function* () {
        const files = yield* Files;
        return yield* files.isDirectory("/repo/src/index.ts");
      }),
    );
    expect(result).toBe(false);
  });
});
