import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { BackHandler } from "react-native";

export const Screen = () => {
  const subscribe = useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);
  useFocusEffect(subscribe);
  return null;
};
