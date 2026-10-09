// rule: effect-needs-cleanup
// verdict: safe
import { useEffect } from "react";
import { Keyboard } from "react-native";
export const Panel = ({ enabled, extra }) => {
  useEffect(() => {
    if (!enabled) return;
    const subscriptions = [Keyboard.addListener("keyboardDidShow", () => {})];
    if (extra) subscriptions.push(Keyboard.addListener("keyboardWillShow", () => {}));
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [enabled, extra]);
};
