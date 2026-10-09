// rule: effect-needs-cleanup
// weakness: library-idiom
// source: https://github.com/millionco/react-doctor/issues/1897
// verdict: fail
import { useCallback } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

export const Screen = () => {
  useFocusEffect(
    useCallback(() => {
      BackHandler.addEventListener("hardwareBackPress", () => true);
    }, []),
  );
  return null;
};
