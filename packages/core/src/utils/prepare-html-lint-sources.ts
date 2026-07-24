import * as fs from "node:fs";
import * as path from "node:path";
import { HTML_FILE_PATTERN } from "../constants.js";
import { containsThreeModuleImport } from "./contains-three-module-import.js";
import { prepareHtmlScriptSource } from "./prepare-html-script-source.js";

export interface PreparedHtmlLintSources {
  readonly lintFiles: string[];
  readonly sourcePathByLintPath: ReadonlyMap<string, string>;
  readonly sizeByLintPath: ReadonlyMap<string, number>;
  readonly hasThreeModuleImport: boolean;
}

export const prepareHtmlLintSources = (
  rootDirectory: string,
  temporaryDirectory: string,
  candidateFiles: ReadonlyArray<string>,
): PreparedHtmlLintSources => {
  const lintFiles: string[] = [];
  const sourcePathByLintPath = new Map<string, string>();
  const sizeByLintPath = new Map<string, number>();
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
    const sourceBuffer = fs.readFileSync(absoluteSourcePath);
    // HACK: Oxlint's Astro frontend visits fallback text inside `script[src]`,
    // although browsers ignore it. Mask only those bodies while retaining every
    // byte offset and line break used to map diagnostics back to the HTML file.
    const { executableScriptBodies, lintBuffer } = prepareHtmlScriptSource(sourceBuffer);
    if (htmlFileIndex === 0) fs.mkdirSync(htmlSourcesDirectory, { recursive: true });
    // HACK: Oxlint does not parse `.html`, but its Astro frontend accepts
    // standard HTML and provides executable script blocks to JS plugins with
    // source spans unchanged.
    const lintPath = path.join(htmlSourcesDirectory, `${htmlFileIndex}.astro`);
    fs.writeFileSync(lintPath, lintBuffer);
    lintFiles.push(lintPath);
    sourcePathByLintPath.set(path.resolve(lintPath), candidateFile);
    sizeByLintPath.set(lintPath, sourceBuffer.length);
    hasThreeModuleImport ||= executableScriptBodies.some((scriptBody) =>
      containsThreeModuleImport(scriptBody.toString("utf8")),
    );
    htmlFileIndex++;
  }

  return {
    lintFiles,
    sourcePathByLintPath,
    sizeByLintPath,
    hasThreeModuleImport,
  };
};
