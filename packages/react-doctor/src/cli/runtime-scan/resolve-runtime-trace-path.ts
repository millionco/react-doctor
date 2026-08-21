import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { RUNTIME_SCAN_TRACE_FILE_EXTENSION } from "./constants.js";

export const resolveRuntimeTracePath = (traceOut: string | undefined, capturedAt: Date): string => {
  if (traceOut !== undefined) return path.resolve(traceOut);
  const timestamp = capturedAt.toISOString().replaceAll(/[:.]/g, "-");
  return path.join(
    os.tmpdir(),
    `react-doctor-runtime-${timestamp}-${randomUUID()}${RUNTIME_SCAN_TRACE_FILE_EXTENSION}`,
  );
};
