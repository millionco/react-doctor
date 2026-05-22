import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as fs from "node:fs";
import * as Path from "node:path";
import { Diagnostic } from "../schemas.js";

/**
 * Captured-diagnostic store backing `Reporter.layerCapture`. Exposed
 * as its own service so tests `yield* ReporterCapture` to read the
 * captured array without going through Reporter.
 */
export class ReporterCapture extends Context.Service<
  ReporterCapture,
  Ref.Ref<{
    readonly diagnostics: ReadonlyArray<Diagnostic>;
    readonly partialFailures: ReadonlyArray<string>;
  }>
>()("react-doctor/ReporterCapture") {
  static readonly layer = Layer.effect(
    ReporterCapture,
    Ref.make({
      diagnostics: [] as ReadonlyArray<Diagnostic>,
      partialFailures: [] as ReadonlyArray<string>,
    }),
  );
}

/**
 * `Reporter` is the single side-channel for "things happened" during
 * the diagnostic pipeline. The orchestrator returns the final
 * diagnostic array via `Stream.runCollect` regardless, so production
 * uses `layerNoop`; `layerCapture` powers tests; `layerNdjson` ships
 * diagnostics + partial failures to disk for the eval harness.
 */
export class Reporter extends Context.Service<
  Reporter,
  {
    readonly emit: (diagnostic: Diagnostic) => Effect.Effect<void>;
    readonly partialFailure: (reason: string) => Effect.Effect<void>;
    readonly finalize: Effect.Effect<void>;
  }
>()("react-doctor/Reporter") {
  static readonly layerNoop: Layer.Layer<Reporter> = Layer.succeed(
    Reporter,
    Reporter.of({
      emit: () => Effect.void,
      partialFailure: () => Effect.void,
      finalize: Effect.void,
    }),
  );

  static readonly layerCapture: Layer.Layer<Reporter | ReporterCapture> = Layer.effect(
    Reporter,
    Effect.map(ReporterCapture, (captured) =>
      Reporter.of({
        emit: (diagnostic) =>
          Ref.update(captured, (current) => ({
            ...current,
            diagnostics: [...current.diagnostics, diagnostic],
          })),
        partialFailure: (reason) =>
          Ref.update(captured, (current) => ({
            ...current,
            partialFailures: [...current.partialFailures, reason],
          })),
        finalize: Effect.void,
      }),
    ),
  ).pipe(Layer.provideMerge(ReporterCapture.layer));

  /**
   * Append-only NDJSON reporter. Schema-encodes each diagnostic at
   * the wire boundary so the eval harness reads back via the same
   * `Diagnostic` schema. Partial failures get tagged lines
   * (`{"_tag":"PartialFailure","reason":"..."}`) so a stream consumer
   * can route them separately.
   */
  static readonly layerNdjson = (filePath: string): Layer.Layer<Reporter> =>
    Layer.effect(
      Reporter,
      Effect.sync(() => {
        fs.mkdirSync(Path.dirname(filePath), { recursive: true });
        const handle = fs.openSync(filePath, "a");
        const encode = Schema.encodeUnknownSync(Diagnostic);

        const emit = (diagnostic: Diagnostic): Effect.Effect<void> =>
          Effect.sync(() => {
            fs.writeSync(handle, `${JSON.stringify(encode(diagnostic))}\n`);
          });

        const partialFailure = (reason: string): Effect.Effect<void> =>
          Effect.sync(() => {
            fs.writeSync(handle, `${JSON.stringify({ _tag: "PartialFailure", reason })}\n`);
          });

        const finalize = Effect.sync(() => {
          fs.closeSync(handle);
        });

        return Reporter.of({ emit, partialFailure, finalize });
      }),
    );
}
