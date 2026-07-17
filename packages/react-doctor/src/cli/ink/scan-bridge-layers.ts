import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Progress, Reporter } from "@react-doctor/core";
import type { ProgressHandle } from "@react-doctor/core";
import type { ScanStore } from "./scan-store.js";

export const reporterLayerForStore = (store: ScanStore): Layer.Layer<Reporter> =>
  Layer.succeed(
    Reporter,
    Reporter.of({
      emit: (diagnostic) => Effect.sync(() => store.emitDiagnostic(diagnostic)),
      finalize: Effect.void,
    }),
  );

export const progressHandleForStore =
  (store: ScanStore) =>
  (text: string): ProgressHandle => {
    store.setProgress(text);
    return {
      update: (displayText) => Effect.sync(() => store.setProgress(displayText)),
      succeed: (displayText) => Effect.sync(() => store.setProgress(displayText)),
      fail: (displayText) => Effect.sync(() => store.setProgress(displayText)),
      stop: () => Effect.sync(() => store.setProgress(null)),
    };
  };

export const progressLayerForStore = (store: ScanStore): Layer.Layer<Progress> =>
  Progress.layerOra(progressHandleForStore(store));
