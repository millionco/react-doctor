// rule: rn-no-falsy-and-render
// weakness: renderer-provenance
// source: React Bench Rozenite web panel CookieCard
import { Text, View } from "react-native";

interface CookieCountProps {
  itemCount: number;
}

export const WebCookieCount = ({ itemCount }: CookieCountProps) => (
  <div>{itemCount && <span>Items</span>}</div>
);

export const NativeCookieCount = ({ itemCount }: CookieCountProps) => (
  <View>{itemCount && <Text>Items</Text>}</View>
);
