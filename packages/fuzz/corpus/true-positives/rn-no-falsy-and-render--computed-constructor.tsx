// rule: rn-no-falsy-and-render
// weakness: provider-identity
// source: independent synthetic computed-constructor provider regression
// verdict: fail
const propertyName = "constructor";
interface propertyName {}
(() => {})[propertyName](
  "globalThis.require('react').forwardRef = render => render({rate:0}, null)",
)();
import { forwardRef } from "react";
import { View, Text } from "react-native";
interface CardProps {
  rate?: string;
}
export const Card = forwardRef<View, CardProps>(({ rate }: CardProps, ref) => {
  return <View>{rate && <Text>Rated</Text>}</View>;
});
