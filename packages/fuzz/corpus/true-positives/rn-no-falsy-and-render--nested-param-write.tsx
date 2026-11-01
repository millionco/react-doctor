// rule: rn-no-falsy-and-render
// weakness: runtime-parameter-identity
// source: independent synthetic merged parameter binding regression
// verdict: fail
import { forwardRef } from "react";
import { View, Text } from "react-native";
interface CardProps {
  rate?: string;
}
export const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {
  const update = () => {
    interface rate {}
    rate = 0;
  };
  return <View>{rate && <Text>Rated</Text>}</View>;
});
