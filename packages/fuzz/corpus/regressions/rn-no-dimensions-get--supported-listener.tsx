// rule: rn-no-dimensions-get
// verdict: pass
// weakness: library-idiom
// source: independently synthetic supported native subscription
import { Dimensions } from "react-native";

export const subscribeToViewport = () => {
  const subscription = Dimensions.addEventListener("change", () => {});
  return () => subscription.remove();
};
