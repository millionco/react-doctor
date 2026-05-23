import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  installNodeViaNvm as installNodeViaNvmSync,
  isNvmInstalled as isNvmInstalledSync,
  resolveNodeForOxlint as resolveNodeForOxlintSync,
} from "../resolve-compatible-node.js";

export interface NodeResolution {
  readonly binaryPath: string;
  readonly isCurrentNode: boolean;
  readonly version: string;
}

/**
 * `NodeResolver` wraps the imperative node-detection / nvm helpers
 * (`resolve-compatible-node.ts`) behind a Context.Service so the
 * `resolveOxlintNode` CLI helper — and any future caller that needs
 * to pick a Node binary compatible with the oxlint native binding —
 * can be tested without a real nvm install.
 *
 * The methods stay synchronous (`Effect.sync` / `Effect.try`) so the
 * existing sync CLI path doesn't need to flip to async; the
 * service is purely a DI seam plus testable surface.
 */
export class NodeResolver extends Context.Service<
  NodeResolver,
  {
    /**
     * Returns the path + version of a Node binary that can load
     * oxlint's native binding, falling back through `process.execPath`,
     * the user's nvm install, then `null`.
     */
    readonly resolve: () => Effect.Effect<NodeResolution | null>;
    readonly isNvmInstalled: () => Effect.Effect<boolean>;
    readonly installViaNvm: () => Effect.Effect<boolean>;
  }
>()("react-doctor/NodeResolver") {
  static readonly layerNode: Layer.Layer<NodeResolver> = Layer.succeed(
    NodeResolver,
    NodeResolver.of({
      resolve: () => Effect.sync(() => resolveNodeForOxlintSync()),
      isNvmInstalled: () => Effect.sync(() => isNvmInstalledSync()),
      installViaNvm: () => Effect.sync(() => installNodeViaNvmSync()),
    }),
  );

  /**
   * Test layer with a predetermined resolution. `installViaNvm` flips
   * the snapshot to the supplied "after-install" resolution when the
   * caller exercises the install prompt branch.
   */
  static readonly layerOf = (snapshot: {
    readonly resolution?: NodeResolution | null;
    readonly afterInstall?: NodeResolution | null;
    readonly isNvmInstalled?: boolean;
  }): Layer.Layer<NodeResolver> =>
    Layer.sync(NodeResolver, () => {
      let current: NodeResolution | null = snapshot.resolution ?? null;
      const afterInstall = snapshot.afterInstall ?? null;
      return NodeResolver.of({
        resolve: () => Effect.succeed(current),
        isNvmInstalled: () => Effect.succeed(snapshot.isNvmInstalled ?? false),
        installViaNvm: () =>
          Effect.sync(() => {
            if (afterInstall === null) return false;
            current = afterInstall;
            return true;
          }),
      });
    });
}
