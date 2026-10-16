// rule: rn-no-dimensions-get
// verdict: fail
// weakness: library-idiom
// source: independently synthetic render-time native dimension read
import { Dimensions, View } from "react-native";

export const ViewportPanel = () => {
  const width = Dimensions.get("window").width;
  return <View style={{ width }} />;
};
