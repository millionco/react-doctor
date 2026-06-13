import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { Diagnostic, ReactDoctorConfig } from "../types/index.js";
import { checkSupplyChain } from "../check-supply-chain.js";

interface SupplyChainInput {
  readonly rootDirectory: string;
  readonly userConfig: ReactDoctorConfig | null;
}

/**
 * `SupplyChain` scores the project's direct dependencies against Socket.dev's
 * free, keyless PURL endpoint — the same lookup Socket Firewall's free tier
 * (`sfw`) performs — and streams a diagnostic for each dependency whose
 * worst Socket security axis (supply chain or vulnerability) falls below
 * the configured `supplyChain.minScore`.
 *
 * Runs by default (one network request per dependency); the orchestrator
 * provides `layerOf([])` only when the user opts out via
 * `supplyChain.enabled: false`, and always skips it in `--diff` / `--staged`
 * mode (dependency health is a whole-project property).
 * The underlying `checkSupplyChain` Effect is total/fail-open — per-package
 * timeouts and network failures recover to "skip" — so the stream never
 * fails, mirroring `DeadCode`'s stream shape so the two compose the same way.
 */
export class SupplyChain extends Context.Service<
  SupplyChain,
  {
    readonly run: (input: SupplyChainInput) => Stream.Stream<Diagnostic>;
  }
>()("react-doctor/SupplyChain") {
  static readonly layerNode = Layer.succeed(
    SupplyChain,
    SupplyChain.of({
      run: (input) =>
        Stream.unwrap(
          checkSupplyChain(input).pipe(
            Effect.map((diagnostics) => Stream.fromIterable(diagnostics)),
            // Surface the whole check as one named span (parent of the
            // per-package `Effect.tryPromise` fetches), matching how the
            // other analyzer services tag their work for OTel traces.
            Effect.withSpan("SupplyChain.run"),
          ),
        ),
    }),
  );

  static readonly layerOf = (diagnostics: ReadonlyArray<Diagnostic>): Layer.Layer<SupplyChain> =>
    Layer.succeed(
      SupplyChain,
      SupplyChain.of({
        run: () => Stream.fromIterable(diagnostics),
      }),
    );
}
