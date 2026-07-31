import * as fs from "node:fs";
import * as path from "node:path";
import { convertToTSX } from "@astrojs/compiler/sync";
import { TraceMap } from "@jridgewell/trace-mapping";
import { HTML_FILE_PATTERN } from "../constants.js";
import { containsThreeModuleImport } from "./contains-three-module-import.js";
import { prepareHtmlScriptSource } from "./prepare-html-script-source.js";

const ASTRO_FILE_PATTERN = /\.astro$/;

export interface PreparedSourceMap {
  readonly traceMap: TraceMap;
  readonly generatedBuffer: Buffer;
  readonly sourceBuffer: Buffer;
}

export interface PreparedLintSources {
  readonly lintFiles: string[];
  readonly sourcePathByLintPath: ReadonlyMap<string, string>;
  readonly sourceMapByLintPath: ReadonlyMap<string, PreparedSourceMap>;
  readonly sizeByLintPath: ReadonlyMap<string, number>;
  readonly hasThreeModuleImport: boolean;
}

export const prepareLintSources = (
  rootDirectory: string,
  temporaryDirectory: string,
  candidateFiles: ReadonlyArray<string>,
): PreparedLintSources => {
  const lintFiles: string[] = [];
  const sourcePathByLintPath = new Map<string, string>();
  const sourceMapByLintPath = new Map<string, PreparedSourceMap>();
  const sizeByLintPath = new Map<string, number>();
  const htmlSourcesDirectory = path.join(temporaryDirectory, "html-sources");
  const astroSourcesDirectory = path.join(temporaryDirectory, "astro-sources");
  let htmlFileIndex = 0;
  let astroFileIndex = 0;
  let hasThreeModuleImport = false;

  for (const candidateFile of candidateFiles) {
    if (!HTML_FILE_PATTERN.test(candidateFile) && !ASTRO_FILE_PATTERN.test(candidateFile)) {
      lintFiles.push(candidateFile);
      continue;
    }

    const absoluteSourcePath = path.isAbsolute(candidateFile)
      ? candidateFile
      : path.resolve(rootDirectory, candidateFile);
    const sourceBuffer = fs.readFileSync(absoluteSourcePath);
    if (ASTRO_FILE_PATTERN.test(candidateFile)) {
      const compilerSourcePath = absoluteSourcePath.replaceAll("\\", "/");
      const convertedSource = convertToTSX(sourceBuffer.toString("utf8"), {
        filename: compilerSourcePath,
        sourcemap: "external",
        includeScripts: true,
      });
      if (astroFileIndex === 0) fs.mkdirSync(astroSourcesDirectory, { recursive: true });
      const lintPath = path.join(astroSourcesDirectory, `${astroFileIndex}.tsx`);
      const generatedBuffer = Buffer.from(convertedSource.code);
      fs.writeFileSync(lintPath, generatedBuffer);
      lintFiles.push(candidateFile);
      lintFiles.push(lintPath);
      sourcePathByLintPath.set(path.resolve(lintPath), candidateFile);
      sourceMapByLintPath.set(path.resolve(lintPath), {
        traceMap: new TraceMap(JSON.stringify(convertedSource.map)),
        generatedBuffer,
        sourceBuffer,
      });
      sizeByLintPath.set(lintPath, sourceBuffer.length);
      astroFileIndex++;
      continue;
    }
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
    sourceMapByLintPath,
    sizeByLintPath,
    hasThreeModuleImport,
  };
};
