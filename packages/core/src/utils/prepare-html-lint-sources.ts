import * as fs from "node:fs";
import * as path from "node:path";
import { HTML_FILE_PATTERN } from "../constants.js";
import { containsThreeModuleImport } from "./contains-three-module-import.js";
import { extractHtmlScriptSources } from "./extract-html-script-sources.js";

export interface PreparedHtmlLintSources {
  readonly lintFiles: string[];
  readonly sourcePathByLintPath: ReadonlyMap<string, string>;
  readonly analyzedHtmlFilesWithoutScripts: ReadonlyArray<string>;
  readonly hasThreeModuleImport: boolean;
}

export const prepareHtmlLintSources = (
  rootDirectory: string,
  temporaryDirectory: string,
  candidateFiles: ReadonlyArray<string>,
): PreparedHtmlLintSources => {
  const lintFiles: string[] = [];
  const sourcePathByLintPath = new Map<string, string>();
  const analyzedHtmlFilesWithoutScripts: string[] = [];
  const htmlSourcesDirectory = path.join(temporaryDirectory, "html-sources");
  let htmlFileIndex = 0;
  let hasThreeModuleImport = false;

  for (const candidateFile of candidateFiles) {
    if (!HTML_FILE_PATTERN.test(candidateFile)) {
      lintFiles.push(candidateFile);
      continue;
    }

    const absoluteSourcePath = path.isAbsolute(candidateFile)
      ? candidateFile
      : path.resolve(rootDirectory, candidateFile);
    const extractedSources = extractHtmlScriptSources(fs.readFileSync(absoluteSourcePath, "utf8"));
    if (extractedSources.length === 0) {
      analyzedHtmlFilesWithoutScripts.push(candidateFile);
      continue;
    }

    fs.mkdirSync(htmlSourcesDirectory, { recursive: true });
    for (let scriptIndex = 0; scriptIndex < extractedSources.length; scriptIndex++) {
      const extractedSource = extractedSources[scriptIndex];
      if (extractedSource === undefined) continue;
      const lintPath = path.join(
        htmlSourcesDirectory,
        `${htmlFileIndex}-${scriptIndex}${extractedSource.extension}`,
      );
      fs.writeFileSync(lintPath, extractedSource.content);
      lintFiles.push(lintPath);
      sourcePathByLintPath.set(path.resolve(lintPath), candidateFile);
      hasThreeModuleImport ||= containsThreeModuleImport(extractedSource.content.toString("utf8"));
    }
    htmlFileIndex++;
  }

  return {
    lintFiles,
    sourcePathByLintPath,
    analyzedHtmlFilesWithoutScripts,
    hasThreeModuleImport,
  };
};
