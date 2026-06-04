import * as path from "node:path";

export const createRelativeImportSource = (filename: string, targetFilePath: string): string => {
  const targetPathWithoutExtension = targetFilePath.slice(
    0,
    targetFilePath.length - path.extname(targetFilePath).length,
  );
  const targetModulePath =
    path.basename(targetPathWithoutExtension) === "index"
      ? path.dirname(targetPathWithoutExtension)
      : targetPathWithoutExtension;
  const relativePath = path
    .relative(path.dirname(filename), targetModulePath)
    .split(path.sep)
    .join("/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
};
