// rule: effect-needs-cleanup
// weakness: library-idiom
// source: https://github.com/millionco/react-doctor/issues/1897
// verdict: pass
import { useCallback } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "expo-router";

export const Screen = () => {
  const onFocus = useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);
  useFocusEffect(onFocus);
  return null;
};
