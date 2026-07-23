// rule: rn-bottom-sheet-use-integrated-scrollable
// weakness: control-flow
// source: Cursor Bugbot review on PR #1427
// verdict: pass

import BottomSheet from "@gorhom/bottom-sheet";
import { ScrollView, View } from "react-native";

const sideEffect = () => undefined;

export const ShortCircuitSheetChildren = ({ condition }) => (
  <BottomSheet>
    {<ScrollView /> && <View />}
    {<View /> || <ScrollView />}
    {<View /> ?? <ScrollView />}
    {(sideEffect(), (<View />)) || <ScrollView />}
    {condition && <ScrollView /> && <View />}
    {condition || <View /> || <ScrollView />}
    {condition ?? <View /> ?? <ScrollView />}
    {condition || (<ScrollView /> && <View />)}
  </BottomSheet>
);
