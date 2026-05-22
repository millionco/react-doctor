import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { describe, expect, it } from "vite-plus/test";
import { Diagnostic } from "../../src/schemas.js";
import { Reporter, ReporterCapture } from "../../src/services/reporter.js";

const sampleDiagnostic = new Diagnostic({
  filePath: "/repo/src/App.tsx",
  plugin: "react",
  rule: "no-danger",
  severity: "warning",
  message: "Avoid dangerouslySetInnerHTML",
  help: "Use safer alternatives",
  line: 10,
  column: 1,
  category: "Security",
});

describe("Reporter.layerNoop", () => {
  it("emit and partialFailure return without effect", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        yield* reporter.emit(sampleDiagnostic);
        yield* reporter.partialFailure("oxlint dropped 1 file");
        yield* reporter.finalize;
        return "ok";
      }).pipe(Effect.provide(Reporter.layerNoop)),
    );
    expect(exit._tag).toBe("Success");
  });
});

describe("Reporter.layerCapture", () => {
  it("records emitted diagnostics and partial failures into ReporterCapture Ref", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        yield* reporter.emit(sampleDiagnostic);
        yield* reporter.emit(sampleDiagnostic);
        yield* reporter.partialFailure("batch 3 timed out");
        const ref = yield* ReporterCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Reporter.layerCapture)),
    );
    expect(captured.diagnostics).toHaveLength(2);
    expect(captured.diagnostics[0].rule).toBe("no-danger");
    expect(captured.partialFailures).toEqual(["batch 3 timed out"]);
  });

  it("provides both Reporter and ReporterCapture via a single Layer.provide", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        const ref = yield* ReporterCapture;
        yield* reporter.emit(sampleDiagnostic);
        const state = yield* Ref.get(ref);
        return state.diagnostics.length;
      }).pipe(Effect.provide(Reporter.layerCapture)),
    );
    expect(result).toBe(1);
  });

  it("starts with empty diagnostics and partialFailures", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* ReporterCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Layer.mergeAll(Reporter.layerCapture))),
    );
    expect(captured.diagnostics).toEqual([]);
    expect(captured.partialFailures).toEqual([]);
  });
});
