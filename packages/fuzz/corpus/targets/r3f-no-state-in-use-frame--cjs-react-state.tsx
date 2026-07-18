// rule: r3f-no-state-in-use-frame
const Fiber = require("@react-three/fiber");
const React = require("react");

const [, setFrameCount] = React.useState(0);

Fiber.useFrame(() => setFrameCount((frameCount) => frameCount + 1));
