import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "node:path";
import { isDirectory as isDirectoryNode, isFile as isFileNode } from "../project-info/index.js";
import { createNodeReadFileLinesSync } from "../read-file-lines-node.js";
import { listSourceFiles as listSourceFilesNode } from "../utils/list-source-files.js";

interface ReadLinesInput {
  readonly filePath: string;
  readonly rootDirectory: string;
}

export class Files extends Context.Service<
  Files,
  {
    readonly readLines: (input: ReadLinesInput) => Effect.Effect<ReadonlyArray<string> | null>;
    readonly listSourceFiles: (rootDirectory: string) => Effect.Effect<ReadonlyArray<string>>;
    readonly isFile: (filePath: string) => Effect.Effect<boolean>;
    readonly isDirectory: (filePath: string) => Effect.Effect<boolean>;
  }
>()("react-doctor/Files") {
  static readonly layerNode = Layer.succeed(
    Files,
    Files.of({
      readLines: (input) =>
        Effect.sync(() => createNodeReadFileLinesSync(input.rootDirectory)(input.filePath)),
      listSourceFiles: (rootDirectory) => Effect.sync(() => listSourceFilesNode(rootDirectory)),
      isFile: (filePath) => Effect.sync(() => isFileNode(filePath)),
      isDirectory: (filePath) => Effect.sync(() => isDirectoryNode(filePath)),
    }),
  );

  /**
   * Test layer driven by a `Map<absolutePath, content>`. A descendant
   * file at any depth implies the parent path is a directory; an
   * absent path reads back as `null`. Mirrors the in-memory FS
   * pattern in react-doctor-evals' test layers.
   */
  static readonly layerInMemory = (tree: ReadonlyMap<string, string>): Layer.Layer<Files> => {
    const resolveAbsolute = (filePath: string, rootDirectory: string): string =>
      Path.isAbsolute(filePath) ? filePath : Path.join(rootDirectory, filePath);

    return Layer.succeed(
      Files,
      Files.of({
        readLines: (input) =>
          Effect.sync(() => {
            const absolute = resolveAbsolute(input.filePath, input.rootDirectory);
            const content = tree.get(absolute);
            return content === undefined ? null : content.split("\n");
          }),
        listSourceFiles: (rootDirectory) =>
          Effect.sync(() => {
            const prefix = rootDirectory.endsWith(Path.sep)
              ? rootDirectory
              : `${rootDirectory}${Path.sep}`;
            const files: string[] = [];
            for (const absolute of tree.keys()) {
              if (!absolute.startsWith(prefix)) continue;
              files.push(absolute.slice(prefix.length).split(Path.sep).join("/"));
            }
            return files;
          }),
        isFile: (filePath) => Effect.sync(() => tree.has(filePath)),
        isDirectory: (filePath) =>
          Effect.sync(() => {
            const prefix = filePath.endsWith(Path.sep) ? filePath : `${filePath}${Path.sep}`;
            for (const absolute of tree.keys()) {
              if (absolute.startsWith(prefix)) return true;
            }
            return false;
          }),
      }),
    );
  };
}
