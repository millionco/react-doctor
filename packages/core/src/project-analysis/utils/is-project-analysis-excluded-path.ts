import { relative } from "node:path";
import { isGeneratedSource } from "./is-generated-source.js";

const EXTERNALLY_OWNED_DIRECTORY_PATTERN =
  /(?:^|\/)(?:__testfixtures__|vendor|vendors|third-party|third_party)(?:\/|$)|(?:^|\/)assets\/libs?(?:\/|$)/i;
const FIGMA_CODE_CONNECT_FILE_PATTERN = /\.figma\.[cm]?[jt]sx?$/i;

export const isProjectAnalysisExcludedPath = (
  filePath: string,
  projectRootDirectory: string,
): boolean => {
  const relativeFilePath = relative(projectRootDirectory, filePath).replaceAll("\\", "/");
  const isRootPublicFile = relativeFilePath === "public" || relativeFilePath.startsWith("public/");
  return (
    isRootPublicFile ||
    isGeneratedSource(relativeFilePath, "") ||
    EXTERNALLY_OWNED_DIRECTORY_PATTERN.test(relativeFilePath) ||
    FIGMA_CODE_CONNECT_FILE_PATTERN.test(relativeFilePath)
  );
};
