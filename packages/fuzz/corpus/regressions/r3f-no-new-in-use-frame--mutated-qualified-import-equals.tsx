// rule: r3f-no-new-in-use-frame
import Fiber = require("@react-three/fiber");

Fiber.useFrame = runOnce;

import frame = Fiber.useFrame;

frame(() => new Vector3());
