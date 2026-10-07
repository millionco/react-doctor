// rule: rendering-hydration-no-flicker
// weakness: name-heuristic
// source: 0.8.1-to-main all-rules final adversarial audit

import { useEffect, useState } from "react";

export const CurrentSetting = ({ settings }) => {
  const [currentSetting, setCurrentSetting] = useState("");

  useEffect(() => {
    setCurrentSetting(settings.current);
  }, []);

  return <output>{currentSetting}</output>;
};
