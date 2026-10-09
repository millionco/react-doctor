// rule: rerender-lazy-state-init
// weakness: library-idiom
// source: independently authored primitive conversion regression
import { useState } from "react";
import { Dimensions } from "react-native";
export const Panel = () => {
  const { width, height } = Dimensions.get("window");
  const [right] = useState((width - 20).toString());
  const [bottom] = useState(height.toString());
  return (
    <div>
      {right}:{bottom}
    </div>
  );
};
