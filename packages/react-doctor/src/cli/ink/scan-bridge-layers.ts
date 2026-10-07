import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Progress, Reporter } from "@react-doctor/core";
import type { ProgressHandle } from "@react-doctor/core";
import type { ScanStore } from "./scan-store.js";

export interface ProgressStoreOptions {
  readonly transformText?: (displayText: string) => string;
  readonly shouldClearOnStop?: boolean;
}

export const reporterLayerForStore = (store: ScanStore): Layer.Layer<Reporter> =>
  Layer.succeed(
    Reporter,
    Reporter.of({
      emit: (diagnostic) => Effect.sync(() => store.emitDiagnostic(diagnostic)),
      finalize: Effect.void,
    }),
  );

export const progressHandleForStore =
  (store: ScanStore, options: ProgressStoreOptions = {}) =>
  (text: string): ProgressHandle => {
    const transformText = options.transformText ?? ((displayText: string) => displayText);
    store.setProgress(transformText(text));
    return {
      update: (displayText) =>
        Effect.sync(() => store.scheduleProgress(transformText(displayText))),
      succeed: (displayText) => Effect.sync(() => store.setProgress(transformText(displayText))),
      fail: (displayText) => Effect.sync(() => store.setProgress(transformText(displayText))),
      stop: () =>
        Effect.sync(() =>
          store.setProgress(options.shouldClearOnStop === false ? transformText(text) : null),
        ),
    };
  };

export const progressLayerForStore = (
  store: ScanStore,
  options: ProgressStoreOptions = {},
): Layer.Layer<Progress> => Progress.layerOra(progressHandleForStore(store, options));
