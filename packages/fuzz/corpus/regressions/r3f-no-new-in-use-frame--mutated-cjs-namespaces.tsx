// rule: r3f-no-new-in-use-frame
const Fiber = require("@react-three/fiber");
const React = require("react");

Fiber.useFrame = runOnce;
React.useCallback = discard;

const callback = React.useCallback(() => new Vector3(), []);
Fiber.useFrame(callback);
