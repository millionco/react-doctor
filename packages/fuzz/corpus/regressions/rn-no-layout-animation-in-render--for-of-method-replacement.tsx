// rule: rn-no-layout-animation-in-render
// weakness: alias-guard
// source: independently authored PR2259 review regression
// verdict: pass
import { LayoutAnimation, View } from "react-native";
for (LayoutAnimation.spring of [() => {}]) {
}
export const Tile = () => {
  LayoutAnimation.spring();
  return <View />;
};
