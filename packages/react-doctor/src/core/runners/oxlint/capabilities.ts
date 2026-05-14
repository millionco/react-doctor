import type { ProjectInfo } from "../../../types/project-info.js";
import {
  isTailwindAtLeast,
  parseTailwindMajorMinor,
} from "../../detection/parse-tailwind-major-minor.js";

export const buildCapabilities = (project: ProjectInfo): ReadonlySet<string> => {
  const capabilities = new Set<string>();

  capabilities.add(project.framework);
  if (project.framework === "expo" || project.framework === "react-native") {
    capabilities.add("react-native");
  }

  // HACK: when version detection fails (null), assume the latest React
  // major so every version-gated rule fires. Silently dropping rules
  // on detection failure was the worse outcome in practice.
  const reactMajor = project.reactMajorVersion;
  const effectiveReactMajor = reactMajor ?? 99;
  for (let major = 17; major <= effectiveReactMajor; major++) {
    capabilities.add(`react:${major}`);
  }

  if (project.tailwindVersion !== null) {
    capabilities.add("tailwind");
    const tailwind = parseTailwindMajorMinor(project.tailwindVersion);
    // HACK: when version is unparseable (dist-tag, workspace protocol),
    // assume latest so version-gated rules still fire.
    if (isTailwindAtLeast(tailwind, { major: 3, minor: 4 })) {
      capabilities.add("tailwind:3.4");
    }
  }

  if (project.hasReactCompiler) capabilities.add("react-compiler");
  if (project.hasTanStackQuery) capabilities.add("tanstack-query");
  if (project.hasTypeScript) capabilities.add("typescript");

  return capabilities;
};

export const shouldEnableRule = (
  requires: ReadonlyArray<string> | undefined,
  tags: ReadonlyArray<string> | undefined,
  capabilities: ReadonlySet<string>,
  ignoredTags: ReadonlySet<string>,
): boolean => {
  if (requires) {
    for (const capability of requires) {
      if (!capabilities.has(capability)) return false;
    }
  }
  if (tags) {
    for (const tag of tags) {
      if (ignoredTags.has(tag)) return false;
    }
  }
  return true;
};
