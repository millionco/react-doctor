import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as fs from "node:fs";
import * as path from "node:path";
import { Diagnostic } from "../schemas.js";

/**
 * Captured-diagnostic store backing `Reporter.layerCapture`. Exposed
 * as its own service so tests `yield* ReporterCapture` to read the
 * captured array without going through Reporter.
 */
export class ReporterCapture extends Context.Service<
  ReporterCapture,
  Ref.Ref<ReadonlyArray<Diagnostic>>
>()("react-doctor/ReporterCapture") {
  static readonly layer = Layer.effect(ReporterCapture, Ref.make<ReadonlyArray<Diagnostic>>([]));
}

/**
 * `Reporter` consumes the diagnostic stream a single element at a
 * time. Production uses `layerNoop` since the orchestrator already
 * returns the diagnostic array via `Stream.runCollect` — Reporter
 * is the *side-channel* for an LSP host's `publishDiagnostics`, an
 * NDJSON cache, or a SARIF reporter to plug into without changing
 * the orchestrator. Partial failures live in `LintPartialFailures`,
 * not here, so the production noop layer doesn't accidentally drop
 * them.
 */
export class Reporter extends Context.Service<
  Reporter,
  {
    readonly emit: (diagnostic: Diagnostic) => Effect.Effect<void>;
    readonly finalize: Effect.Effect<void>;
  }
>()("react-doctor/Reporter") {
  static readonly layerNoop: Layer.Layer<Reporter> = Layer.succeed(
    Reporter,
    Reporter.of({
      emit: () => Effect.void,
      finalize: Effect.void,
    }),
  );

  static readonly layerCapture: Layer.Layer<Reporter | ReporterCapture> = Layer.effect(
    Reporter,
    Effect.map(ReporterCapture, (captured) =>
      Reporter.of({
        emit: (diagnostic) => Ref.update(captured, (existing) => [...existing, diagnostic]),
        finalize: Effect.void,
      }),
    ),
  ).pipe(Layer.provideMerge(ReporterCapture.layer));

  /**
   * Append-only NDJSON reporter. Schema-encodes each diagnostic at
   * the wire boundary so the eval harness reads back via the same
   * `Diagnostic` schema.
   */
  static readonly layerNdjson = (filePath: string): Layer.Layer<Reporter> =>
    Layer.effect(
      Reporter,
      Effect.sync(() => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const handle = fs.openSync(filePath, "a");
        const encode = Schema.encodeUnknownSync(Diagnostic);

        const emit = (diagnostic: Diagnostic): Effect.Effect<void> =>
          Effect.sync(() => {
            fs.writeSync(handle, `${JSON.stringify(encode(diagnostic))}\n`);
          });

        const finalize = Effect.sync(() => {
          fs.closeSync(handle);
        });

        return Reporter.of({ emit, finalize });
      }),
    );
}
