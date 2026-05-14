import type { ProjectInfo } from "../../../types/project-info.js";

export type RuleSeverity = "error" | "warn" | "off";

export interface OxlintConfigOptions {
  pluginPath: string;
  project: ProjectInfo;
  customRulesOnly?: boolean;
  extendsPaths?: string[];
  ignoredTags?: ReadonlySet<string>;
}
