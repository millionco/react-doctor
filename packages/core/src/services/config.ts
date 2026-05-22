import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ReactDoctorConfig } from "@react-doctor/types";
import { loadConfigWithSource } from "../load-config.js";
import { resolveConfigRootDir } from "../resolve-config-root-dir.js";

export interface ResolvedConfig {
  readonly config: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
}

const CONFIG_CACHE_CAPACITY = 16;
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1_000;

export class Config extends Context.Service<
  Config,
  {
    readonly resolve: (directory: string) => Effect.Effect<ResolvedConfig>;
  }
>()("react-doctor/Config") {
  static readonly layerNode = Layer.effect(
    Config,
    Effect.gen(function* () {
      const cache = yield* Cache.make<string, ResolvedConfig>({
        capacity: CONFIG_CACHE_CAPACITY,
        timeToLive: CONFIG_CACHE_TTL_MS,
        lookup: (directory) =>
          Effect.sync(() => {
            const loaded = loadConfigWithSource(directory);
            const redirected = resolveConfigRootDir(
              loaded?.config ?? null,
              loaded?.sourceDirectory ?? null,
            );
            return {
              config: loaded?.config ?? null,
              resolvedDirectory: redirected ?? directory,
            };
          }),
      });
      return Config.of({
        resolve: (directory) => Cache.get(cache, directory),
      });
    }),
  );

  static readonly layerOf = (resolved: ResolvedConfig): Layer.Layer<Config> =>
    Layer.succeed(
      Config,
      Config.of({
        resolve: () => Effect.succeed(resolved),
      }),
    );
}
