import type { SourceProjectIndex } from "./build-source-project-index.js";
import { SOURCE_PROJECT_FILE_PATTERN } from "./list-production-source-files.js";
import { walkAst } from "./walk-ast.js";

export const hasUnindexedRuntimeSource = (project: SourceProjectIndex): boolean => {
  let hasUnindexedSource = false;
  for (const module of project.modulesByFilePath.values()) {
    walkAst(module.programNode, (node) => {
      const resolvedSource = project.resolvedSourcePathByNode.get(node);
      if (
        resolvedSource &&
        SOURCE_PROJECT_FILE_PATTERN.test(resolvedSource) &&
        !project.modulesByFilePath.has(resolvedSource)
      )
        hasUnindexedSource = true;
    });
    if (hasUnindexedSource) return true;
  }
  return false;
};
