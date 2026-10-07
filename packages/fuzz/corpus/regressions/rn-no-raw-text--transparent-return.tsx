// rule: rn-no-raw-text
// verdict: pass
// weakness: wrapper-transparency
// source: issue #1729

import { Text } from "react-native";

export const FbtLabel = () => <fbt desc="d">Travel with confidence</fbt>;

export const StringLabel = () => "Travel with confidence";

export const Screen = () => (
  <Text>
    <FbtLabel />
    <StringLabel />
  </Text>
);
