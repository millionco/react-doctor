// rule: rn-no-layout-animation-in-render
// weakness: control-flow
// source: synthetic source-review regression
// verdict: pass
import { LayoutAnimation, View } from "react-native";
export const Tile = () => {
  // eslint-disable-next-line no-constant-condition
  if (0) LayoutAnimation.spring();
  return <View />;
};
