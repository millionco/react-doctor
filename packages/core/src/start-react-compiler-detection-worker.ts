import * as path from "node:path";
import { parentPort } from "node:worker_threads";
import { detectReactCompiler } from "./project-info/detect-react-compiler.js";
import { isFile } from "./project-info/fs-utils.js";
import { readPackageJson } from "./project-info/package-json.js";
import {
  isReactCompilerDetectionRequest,
  type ReactCompilerDetectionReply,
} from "./project-info/react-compiler-detection-worker-protocol.js";

// Mirrors the package.json branch of `discoverProject` exactly: the same
// manifest read feeds the same detector, so the reply is the value discovery
// would have computed itself. `null` leaves the decision to the parent.
const detectForDirectory = (directory: string): boolean | null => {
  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) return null;
  try {
    return detectReactCompiler(directory, readPackageJson(packageJsonPath));
  } catch {
    return null;
  }
};

export const startReactCompilerDetectionWorker = (): void => {
  if (parentPort === null) {
    throw new Error("React Compiler detection worker must run as a worker thread.");
  }
  const port = parentPort;
  port.on("message", (message: unknown) => {
    if (!isReactCompilerDetectionRequest(message)) return;
    const reply: ReactCompilerDetectionReply = {
      id: message.id,
      hasReactCompiler: detectForDirectory(message.directory),
    };
    port.postMessage(reply);
  });
};
