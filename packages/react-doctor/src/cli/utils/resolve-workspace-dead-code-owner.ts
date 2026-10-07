import * as path from "node:path";

export interface ResolveWorkspaceDeadCodeOwnerInput {
  readonly rootDirectory: string;
  readonly projectDirectories: ReadonlyArray<string>;
  readonly isRootDeadCodeEnabled: boolean;
}

export const resolveWorkspaceDeadCodeOwner = (
  input: ResolveWorkspaceDeadCodeOwnerInput,
): string | null => {
  if (!input.isRootDeadCodeEnabled) return null;
  const resolvedRootDirectory = path.resolve(input.rootDirectory);
  return (
    input.projectDirectories.find(
      (projectDirectory) => path.resolve(projectDirectory) === resolvedRootDirectory,
    ) ?? null
  );
};
