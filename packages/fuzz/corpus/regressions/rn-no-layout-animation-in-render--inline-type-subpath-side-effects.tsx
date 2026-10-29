// rule: rn-no-layout-animation-in-render
// weakness: framework-gating
// source: independently authored PR2259 review regression
// verdict: pass
import { type ViewProps } from "react-native/Libraries/Components/View/ViewPropTypes";
import { LayoutAnimation, View } from "react-native";
export const Tile = () => {
  LayoutAnimation.spring();
  return <View />;
};
