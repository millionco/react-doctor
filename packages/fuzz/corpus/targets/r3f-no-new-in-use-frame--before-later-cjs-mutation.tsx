// rule: r3f-no-new-in-use-frame
const Fiber = require("@react-three/fiber");

Fiber.useFrame(() => new Vector3());
Fiber.useFrame = runOnce;
