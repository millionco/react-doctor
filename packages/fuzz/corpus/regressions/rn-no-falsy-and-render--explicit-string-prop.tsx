// rule: rn-no-falsy-and-render
// verdict: pass
import { forwardRef } from "react";
import { View, Text } from "react-native";
interface BadgeProps {
  rate?: string;
}
export const Badge = forwardRef<View, BadgeProps>(({ rate }: BadgeProps, _ref) => (
  <View>{rate && <Text>Ready</Text>}</View>
));
