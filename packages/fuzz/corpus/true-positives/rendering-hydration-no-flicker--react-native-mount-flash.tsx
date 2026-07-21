// rule: rendering-hydration-no-flicker
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity audit
// verdict: fail

import { useEffect, useState } from "react";
import { Text } from "react-native";

export const WelcomeMessage = () => {
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMessage("Welcome back");
  }, []);

  return <Text>{message}</Text>;
};
