import type { ProjectInfo } from "@react-doctor/types";
import { isTailwindAtLeast, parseTailwindMajorMinor } from "@react-doctor/project-info";

export const buildCapabilities = (project: ProjectInfo): ReadonlySet<string> => {
  const capabilities = new Set<string>();

  capabilities.add(project.framework);
  if (
    project.framework === "expo" ||
    project.framework === "react-native" ||
    project.hasReactNativeWorkspace
  ) {
    // `hasReactNativeWorkspace` covers the inverted case the
    // file-level gate alone cannot reach: a web-rooted monorepo
    // (`next` / `vite` at the entry point) whose `apps/mobile`
    // workspace targets React Native. Without this, every `rn-*`
    // rule is dropped before the file-level package boundary in
    // `oxlint-plugin-react-doctor` ever runs.
    capabilities.add("react-native");
  }

  const reactMajor = project.reactMajorVersion;
  if (reactMajor !== null) {
    for (let major = 17; major <= reactMajor; major++) {
      capabilities.add(`react:${major}`);
    }
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
