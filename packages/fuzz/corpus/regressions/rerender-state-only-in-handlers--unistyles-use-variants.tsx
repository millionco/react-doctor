// rule: rerender-state-only-in-handlers
// weakness: library-idiom
// source: GitHub issue #1716
// verdict: pass

import { useState } from "react";
import { TextInput } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const styles = StyleSheet.create(() => ({
  input: {
    variants: {
      state: {
        focused: { borderColor: "blue", borderWidth: 2 },
      },
    },
  },
}));

export const Input = () => {
  const [focused, setFocused] = useState(false);
  const state = focused ? "focused" : undefined;

  styles.useVariants({ state });

  return (
    <TextInput
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      style={styles.input}
    />
  );
};
