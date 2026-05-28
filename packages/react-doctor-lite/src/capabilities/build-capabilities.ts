import { isReactNativeDependencyName } from "oxlint-plugin-react-doctor";
import {
  MIN_GATED_REACT_MAJOR,
  REACT_COMPILER_DEPENDENCY_NAMES,
  TANSTACK_QUERY_DEPENDENCY_NAMES,
} from "../constants.js";
import type { DependencyGraph } from "../types.js";

const hasReactNativeAnywhere = (graph: DependencyGraph): boolean =>
  graph.packages.some((node) =>
    [...node.dependencies.keys()].some((name) => isReactNativeDependencyName(name)),
  );

// Derives the capability token set the oxlint-plugin-react-doctor rules gate
// on (`react:19`, `tanstack-query`, `tailwind:3.4`, …) entirely from
// dependency-graph queries. This is the bridge that lets the existing
// `requires` / `disabledBy` rule metadata keep working while the underlying
// detection collapses into the composable graph.
export const buildCapabilities = (graph: DependencyGraph): Set<string> => {
  const capabilities = new Set<string>();

  capabilities.add(graph.framework);

  if (
    graph.framework === "expo" ||
    graph.framework === "react-native" ||
    hasReactNativeAnywhere(graph)
  ) {
    capabilities.add("react-native");
  }

  const reactMajor = graph.getMajor("react");
  if (reactMajor !== null) {
    for (let major = MIN_GATED_REACT_MAJOR; major <= reactMajor; major++) {
      capabilities.add(`react:${major}`);
    }
    if (reactMajor >= 19 && graph.hasDependency("react", ">=19.2")) {
      capabilities.add("react:19.2");
    }
  }

  if (graph.getMajor("tailwindcss") !== null) {
    capabilities.add("tailwind");
    if (graph.hasDependency("tailwindcss", ">=3.4")) {
      capabilities.add("tailwind:3.4");
    }
  }

  if (graph.hasAnyDependency([...REACT_COMPILER_DEPENDENCY_NAMES])) {
    capabilities.add("react-compiler");
  }
  if (graph.hasAnyDependency([...TANSTACK_QUERY_DEPENDENCY_NAMES])) {
    capabilities.add("tanstack-query");
  }
  if (graph.hasDependency("typescript")) {
    capabilities.add("typescript");
  }
  if (graph.hasDependency("preact")) {
    capabilities.add("preact");
    if (graph.getVersion("react") === null) {
      capabilities.add("pure-preact");
    }
  }

  return capabilities;
};
