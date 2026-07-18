// rule: r3f-no-internal-imports
import { createRoot } from "@react-three/fiber/dist/declarations/src/core";

export const root = createRoot(document.createElement("canvas"));
