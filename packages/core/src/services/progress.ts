import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

/**
 * Handle returned by `Progress.start`. Call `update` zero or more
 * times for intermediate status changes, then terminate exactly once
 * with `succeed`, `fail`, or `stop`. `stop` clears the in-progress
 * line without leaving a persistent status line — used when the caller
 * renders an aggregate summary in its place (e.g. multi-project scans).
 * Callers don't manage the underlying implementation (ora instance,
 * log lines, GitHub Action group, etc).
 */
export interface ProgressHandle {
  readonly update: (displayText: string) => Effect.Effect<void>;
  readonly succeed: (displayText: string) => Effect.Effect<void>;
  readonly fail: (displayText: string) => Effect.Effect<void>;
  readonly stop: () => Effect.Effect<void>;
}

export interface ProgressEvent {
  readonly _tag: "Started" | "Updated" | "Succeeded" | "Failed" | "Stopped";
  readonly text: string;
}

export class ProgressCapture extends Context.Service<
  ProgressCapture,
  Ref.Ref<ReadonlyArray<ProgressEvent>>
>()("react-doctor/ProgressCapture") {
  static readonly layer = Layer.effect(ProgressCapture, Ref.make<ReadonlyArray<ProgressEvent>>([]));
}

/**
 * `Progress` is the terminal-feedback service. Layer slot for ora
 * (CLI), log lines, GitHub Action `::group::`, or a no-op for silent
 * modes. Tests use `layerCapture` to record start/succeed/fail
 * events into a Ref instead of mocking the underlying spinner module.
 */
export class Progress extends Context.Service<
  Progress,
  {
    readonly start: (text: string) => Effect.Effect<ProgressHandle>;
  }
>()("react-doctor/Progress") {
  /**
   * Layer that uses an injected factory. The cli package provides
   * its own factory backed by the existing ora-based `spinner.ts`
   * helper; this layer keeps the core package free of an ora dep.
   */
  static readonly layerOra = (factory: (text: string) => ProgressHandle): Layer.Layer<Progress> =>
    Layer.succeed(
      Progress,
      Progress.of({
        start: (text) => Effect.sync(() => factory(text)),
      }),
    );

  static readonly layerNoop: Layer.Layer<Progress> = Layer.succeed(
    Progress,
    Progress.of({
      start: () =>
        Effect.succeed({
          update: () => Effect.void,
          succeed: () => Effect.void,
          fail: () => Effect.void,
          stop: () => Effect.void,
        }),
    }),
  );

  static readonly layerCapture: Layer.Layer<Progress | ProgressCapture> = Layer.effect(
    Progress,
    Effect.map(ProgressCapture, (events) =>
      Progress.of({
        start: (text) =>
          Effect.gen(function* () {
            yield* Ref.update(events, (existing) => [
              ...existing,
              { _tag: "Started" as const, text },
            ]);
            return {
              update: (displayText: string) =>
                Ref.update(events, (existing) => [
                  ...existing,
                  { _tag: "Updated" as const, text: displayText },
                ]),
              succeed: (displayText: string) =>
                Ref.update(events, (existing) => [
                  ...existing,
                  { _tag: "Succeeded" as const, text: displayText },
                ]),
              fail: (displayText: string) =>
                Ref.update(events, (existing) => [
                  ...existing,
                  { _tag: "Failed" as const, text: displayText },
                ]),
              stop: () =>
                Ref.update(events, (existing) => [...existing, { _tag: "Stopped" as const, text }]),
            };
          }),
      }),
    ),
  ).pipe(Layer.provideMerge(ProgressCapture.layer));
}
