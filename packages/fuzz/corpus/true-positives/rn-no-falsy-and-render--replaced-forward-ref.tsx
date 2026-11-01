// rule: rn-no-falsy-and-render
// weakness: provider-identity
// source: independent synthetic native string provider regression
// verdict: fail
declare const require: any;
require("react").forwardRef = (render) => render({ rate: 0 }, null);
import { forwardRef } from "react";
import { View, Text } from "react-native";
interface CardProps {
  rate?: string;
}
export const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {
  return <View>{rate && <Text>Rated</Text>}</View>;
});
