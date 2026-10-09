// rule: effect-needs-cleanup
// weakness: library-idiom
// source: https://github.com/millionco/react-doctor/issues/1897
// verdict: pass
import { useCallback } from "react";
import { useFocusEffect } from "expo-router";

export const Screen = () => {
  useFocusEffect(
    useCallback(() => {
      const setup = () => {
        const timer = setInterval(() => {}, 1000);
        return () => clearInterval(timer);
      };
      return setup();
    }, []),
  );
  return null;
};
