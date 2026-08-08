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
  message:
    "dangerouslySetInnerHTML bypasses React escaping, so untrusted HTML can execute script in the user's browser.",
  help: "Render structured React content instead, or sanitize trusted HTML before passing it to dangerouslySetInnerHTML.",
  line: 10,
  column: 1,
  category: "Security",
});

describe("Reporter.layerNoop", () => {
  it("emit and finalize return without effect", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        yield* reporter.emit(sampleDiagnostic);
        yield* reporter.finalize;
        return "ok";
      }).pipe(Effect.provide(Reporter.layerNoop)),
    );
    expect(exit._tag).toBe("Success");
  });
});

describe("Reporter.layerCapture", () => {
  it("records emitted diagnostics into ReporterCapture Ref", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        yield* reporter.emit(sampleDiagnostic);
        yield* reporter.emit(sampleDiagnostic);
        const ref = yield* ReporterCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Reporter.layerCapture)),
    );
    expect(captured).toHaveLength(2);
    expect(captured[0].rule).toBe("no-danger");
  });

  it("provides both Reporter and ReporterCapture via a single Layer.provide", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const reporter = yield* Reporter;
        const ref = yield* ReporterCapture;
        yield* reporter.emit(sampleDiagnostic);
        const state = yield* Ref.get(ref);
        return state.length;
      }).pipe(Effect.provide(Reporter.layerCapture)),
    );
    expect(result).toBe(1);
  });

  it("starts with empty diagnostics", async () => {
    const captured = await Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* ReporterCapture;
        return yield* Ref.get(ref);
      }).pipe(Effect.provide(Layer.mergeAll(Reporter.layerCapture))),
    );
    expect(captured).toEqual([]);
  });
});
