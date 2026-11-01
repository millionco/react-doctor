// rule: rn-no-falsy-and-render
// weakness: runtime-parameter-identity
// source: independent synthetic merged parameter binding regression
// verdict: pass
import { forwardRef } from "react";
import { View, Text } from "react-native";
interface CardProps {
  rate?: string;
}
export const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {
  interface rate {}
  return <View>{rate && <Text>Rated</Text>}</View>;
});
