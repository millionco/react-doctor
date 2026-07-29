import { createResourceHost } from "./create-resource-host.js";
import { createRealResourceHostBackend } from "./real-resource-host-backend.js";
import type { RealFilesystemResourceHostInput, ResourceHost } from "./resource-host.js";

export const createRealFilesystemResourceHost = (
  input: RealFilesystemResourceHostInput,
): ResourceHost => createResourceHost(createRealResourceHostBackend(input));
