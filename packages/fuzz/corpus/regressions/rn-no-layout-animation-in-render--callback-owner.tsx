// rule: rn-no-layout-animation-in-render
// weakness: name-heuristic
// source: synthetic source-review regression
// verdict: pass
import { LayoutAnimation, View, Pressable } from "react-native";
const BuildPreview = () => {
  LayoutAnimation.spring();
  return <View />;
};
export const Screen = () => <Pressable onPress={BuildPreview} />;
