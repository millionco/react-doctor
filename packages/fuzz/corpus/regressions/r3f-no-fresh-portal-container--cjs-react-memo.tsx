const Fiber = require("@react-three/fiber");
const React = require("react");
const THREE = require("three");

export const World = () => React.useMemo(() => Fiber.createPortal(<mesh />, new THREE.Scene()), []);
