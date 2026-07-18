require("@react-three/fiber");
const React = require("react");

export const Scene = ({ model }) =>
  React.useMemo(() => <primitive object={model.clone()} />, [model]);
