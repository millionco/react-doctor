// rule: rn-no-falsy-and-render
// verdict: fail
import { forwardRef } from "react";
import { View, Text } from "react-native";
interface BadgeProps {
  rate?: number;
}
export const Badge = forwardRef<View, BadgeProps>(({ rate }: BadgeProps, _ref) => (
  <View>{rate && <Text>Ready</Text>}</View>
));
