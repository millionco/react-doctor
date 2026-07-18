// rule: r3f-no-new-in-use-frame
// weakness: wrapper-transparency
// source: adversarial review of millionco/react-doctor#1371
const Fiber = require("@react-three/fiber");

Fiber.useFrame = runOnce;
const { useFrame } = Fiber;
useFrame(() => new Vector3());
