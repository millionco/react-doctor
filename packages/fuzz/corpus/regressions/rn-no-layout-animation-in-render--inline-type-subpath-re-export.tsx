// rule: rn-no-layout-animation-in-render
// weakness: framework-gating
// source: independently authored PR2259 re-export review regression
// verdict: pass
export { type Marker } from "react-native/Libraries/review-side-effect";
import { LayoutAnimation, View } from "react-native";
export const Tile = () => {
  LayoutAnimation.spring();
  return <View />;
};
