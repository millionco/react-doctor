import * as os from "node:os";
import * as path from "node:path";
import {
  RUNTIME_SCAN_TEMP_DIRECTORY_NAME,
  RUNTIME_SCAN_TRACE_FILE_EXTENSION,
} from "./constants.js";

export const resolveRuntimeTracePath = (traceOut: string | undefined, capturedAt: Date): string => {
  if (traceOut !== undefined) return path.resolve(traceOut);
  const timestamp = capturedAt.toISOString().replaceAll(/[:.]/g, "-");
  return path.join(
    os.tmpdir(),
    RUNTIME_SCAN_TEMP_DIRECTORY_NAME,
    `runtime-${timestamp}${RUNTIME_SCAN_TRACE_FILE_EXTENSION}`,
  );
};
