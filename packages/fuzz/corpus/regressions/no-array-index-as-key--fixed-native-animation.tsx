import { useRef } from "react";
import { Animated, View } from "react-native";

export function LevelMeter() {
  const levels = useRef(
    Array(4)
      .fill(0)
      .map(() => new Animated.Value(0)),
  ).current;
  return (
    <View>
      {levels.map((level, index) => (
        <Animated.View key={index} style={{ opacity: level }} />
      ))}
    </View>
  );
}
