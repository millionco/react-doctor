// rule: r3f-no-fresh-use-three-selector
const Fiber = require("@react-three/fiber");
const React = require("react");

const selectCamera = React.useCallback((state) => ({ camera: state.camera }), []);

export const Scene = () => Fiber.useThree(selectCamera);
