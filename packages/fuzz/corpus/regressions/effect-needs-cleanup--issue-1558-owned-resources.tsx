// rule: effect-needs-cleanup
// weakness: library-idiom
// source: issue #1558
// verdict: pass

import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { useEffect } from "react";

export const Connectivity = ({ tabs }) => {
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(() => {});
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribers = tabs.map((tab) => tab.addListener("tabPress", () => {}));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [tabs]);

  useEffect(() => {
    let timer = null;
    const disarm = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const arm = () => {
      if (timer != null) return;
      timer = setTimeout(() => {}, 30000);
    };
    const subscription = AppState.addEventListener("change", arm);
    arm();
    return () => {
      disarm();
      subscription.remove();
    };
  }, []);

  return null;
};
