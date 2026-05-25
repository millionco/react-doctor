import * as Layer from "effect/Layer";
import { Config } from "./services/config.js";
import { DeadCode } from "./services/dead-code.js";
import { Files } from "./services/files.js";
import { Git } from "./services/git.js";
import { Linter, LintPartialFailures } from "./services/linter.js";
import { Project } from "./services/project.js";
import { Reporter } from "./services/reporter.js";
import { Score } from "./services/score.js";

interface InspectLayerOverrides {
  readonly config?: Layer.Layer<Config>;
  readonly deadCode?: Layer.Layer<DeadCode>;
  readonly linter?: Layer.Layer<Linter>;
  readonly reporter?: Layer.Layer<Reporter>;
  readonly score?: Layer.Layer<Score>;
}

export const buildInspectLayers = (overrides: InspectLayerOverrides = {}) =>
  Layer.mergeAll(
    Project.layerNode,
    overrides.config ?? Config.layerNode,
    overrides.deadCode ?? DeadCode.layerNode,
    Files.layerNode,
    Git.layerNode,
    overrides.linter ?? Linter.layerOxlint,
    LintPartialFailures.layerLive,
    overrides.reporter ?? Reporter.layerNoop,
    overrides.score ?? Score.layerHttp,
  );
