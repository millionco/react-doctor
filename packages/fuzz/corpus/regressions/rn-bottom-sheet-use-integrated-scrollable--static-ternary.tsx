// rule: rn-bottom-sheet-use-integrated-scrollable
// weakness: control-flow
// source: Cursor Bugbot review on PR #1427
// verdict: pass

/* eslint-disable no-constant-condition */

import BottomSheet from "@gorhom/bottom-sheet";
import { ScrollView, View } from "react-native";

export const StaticTernarySheetChildren = () => (
  <BottomSheet>
    {false ? <ScrollView /> : <View />}
    {true ? <View /> : <ScrollView />}
  </BottomSheet>
);
