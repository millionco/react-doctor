import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { CONFIG_CACHE_CAPACITY, CONFIG_CACHE_TTL_MS } from "../constants.js";
import type { ReactDoctorConfig } from "../types/index.js";
import { loadConfigWithSource } from "../load-config.js";
import { resolveConfigRootDir } from "../resolve-config-root-dir.js";

export interface ResolvedConfig {
  readonly config: ReactDoctorConfig | null;
  readonly resolvedDirectory: string;
  /**
   * Directory of the `react-doctor.config.json` / `package.json`
   * that supplied `config`. `null` when no config was found.
   * Diverges from `resolvedDirectory` whenever `config.rootDir`
   * redirects the scan — used as the resolution base for relative
   * paths inside the config (e.g. `config.plugins: [...]`).
   */
  readonly configSourceDirectory: string | null;
}

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
          Effect.promise(async () => {
            const loaded = await loadConfigWithSource(directory);
            const redirected = resolveConfigRootDir(
              loaded?.config ?? null,
              loaded?.sourceDirectory ?? null,
            );
            return {
              config: loaded?.config ?? null,
              resolvedDirectory: redirected ?? directory,
              configSourceDirectory: loaded?.sourceDirectory ?? null,
            };
          }),
      });
      return Config.of({
        // `Effect.fn("Config.resolve")` adds an OTel-compatible span
        // name; canonical eval pattern.
        resolve: Effect.fn("Config.resolve")(function* (directory: string) {
          return yield* Cache.get(cache, directory);
        }),
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
