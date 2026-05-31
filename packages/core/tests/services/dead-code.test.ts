import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ProjectInfo } from "@react-doctor/core";
import { DeadCode } from "../../src/services/dead-code.js";

const sampleDiagnostic: Diagnostic = {
  filePath: "src/UnusedFile.tsx",
  plugin: "deslop",
  rule: "unused-file",
  severity: "warning",
  message: "Unused file",
  help: "Delete or import it.",
  line: 0,
  column: 0,
  category: "Maintainability",
};

const sampleInput = {
  rootDirectory: "/repo",
  userConfig: null,
} satisfies {
  rootDirectory: string;
  userConfig: ProjectInfo["framework"] extends string ? null : null;
};

describe("DeadCode.layerOf", () => {
  it("emits the supplied diagnostics as a stream", async () => {
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const deadCode = yield* DeadCode;
        return yield* Stream.runCollect(deadCode.run({ rootDirectory: "/repo", userConfig: null }));
      }).pipe(Effect.provide(DeadCode.layerOf([sampleDiagnostic, sampleDiagnostic]))),
    );
    const items = Array.from(collected);
    expect(items).toHaveLength(2);
    expect(items[0].rule).toBe("unused-file");
  });

  it("emits an empty stream when constructed with []", async () => {
    const collected = await Effect.runPromise(
      Effect.gen(function* () {
        const deadCode = yield* DeadCode;
        return yield* Stream.runCollect(deadCode.run({ rootDirectory: "/repo", userConfig: null }));
      }).pipe(Effect.provide(DeadCode.layerOf([]))),
    );
    expect(Array.from(collected)).toEqual([]);
  });
});

describe("DeadCode.layerNode", () => {
  it("returns an empty stream when the directory has no package.json", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const deadCode = yield* DeadCode;
        return yield* Stream.runCollect(
          deadCode.run({
            rootDirectory: "/this/path/should/not/exist/dead-code-test-12345",
            userConfig: null,
          }),
        );
      }).pipe(Effect.provide(DeadCode.layerNode)),
    );
    // checkDeadCode short-circuits to [] when package.json doesn't exist,
    // so the stream completes successfully with no diagnostics.
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(Array.from(exit.value)).toEqual([]);
    }
  });
});

void sampleInput;
