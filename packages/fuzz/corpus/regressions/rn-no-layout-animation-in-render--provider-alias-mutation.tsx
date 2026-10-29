// rule: rn-no-layout-animation-in-render
// weakness: alias-guard
// source: synthetic source-review regression
// verdict: pass
import { LayoutAnimation, View } from "react-native";
const Motion = LayoutAnimation;
Object.assign(Motion, { spring: () => {} });
export const Tile = () => {
  LayoutAnimation.spring();
  return <View />;
};
