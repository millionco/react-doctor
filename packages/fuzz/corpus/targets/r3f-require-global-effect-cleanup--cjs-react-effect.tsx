// rule: r3f-require-global-effect-cleanup
const Fiber = require("@react-three/fiber");
const React = require("react");

React.useEffect(() => {
  Fiber.addEffect(renderFrame);
}, []);
