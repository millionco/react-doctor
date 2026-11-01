// rule: effect-needs-cleanup
// weakness: control-flow
// source: https://github.com/millionco/react-doctor/pull/1899
// verdict: fail
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";

export const Screen = () => {
  const focus = useCallback(() => {
    const setup = () => {
      const timer = setInterval(tick, 1000);
      return () => clearInterval(timer);
    };
    const cleanup = setup();
    mayThrow();
    return cleanup;
  }, []);
  useFocusEffect(focus);
  return null;
};
