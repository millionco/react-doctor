export const MOBX_REACT_PACKAGE_NAME = "mobx-react";
export const MOBX_REACT_LITE_PACKAGE_NAME = "mobx-react-lite";
export const MOBX_STATE_TREE_PACKAGE_NAME = "mobx-state-tree";
export const MOBX_REACT_OBSERVER_PACKAGE_NAME = "mobx-react-observer";
export const REANIMATED_DEPENDENCY_NAME = "react-native-reanimated";
export const REACT_THREE_FIBER_DEPENDENCY_NAMES = [
  "@react-three/fiber",
  "react-three-fiber",
] as const;
export const REACT_THREE_FIBER_ECOSYSTEM_DEPENDENCY_NAMES = [
  ...REACT_THREE_FIBER_DEPENDENCY_NAMES,
  "@react-three/drei",
] as const;
export const THREE_DEPENDENCY_NAMES = [
  ...REACT_THREE_FIBER_ECOSYSTEM_DEPENDENCY_NAMES,
  "three",
] as const;
export const REACT_ROUTER_DEPENDENCY_NAMES = [
  "@react-router/dev",
  "react-router-dom",
  "react-router",
] as const;
export const TANSTACK_REACT_QUERY_PACKAGE_NAMES = ["@tanstack/react-query", "react-query"] as const;
