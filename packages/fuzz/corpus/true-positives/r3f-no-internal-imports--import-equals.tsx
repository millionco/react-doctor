// rule: r3f-no-internal-imports
// weakness: syntax-coverage
// source: Cursor Bugbot review of PR #1371
import Fiber = require("@react-three/fiber/dist/declarations/src/core");

export const root = Fiber.createRoot(document.createElement("canvas"));
