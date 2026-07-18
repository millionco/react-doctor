require("@react-three/fiber");
const React = require("react");
const THREE = require("three");

export const Scene = () =>
  React.useMemo(() => <mesh material={new THREE.MeshBasicMaterial()} />, []);
