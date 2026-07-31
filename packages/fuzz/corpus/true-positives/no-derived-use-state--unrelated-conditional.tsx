// rule: no-derived-useState
// weakness: control-flow
// source: adversarial validation of controlled local fallback
// verdict: fail
import { useState } from "react";

export const Profile = ({ name, nickname, showNickname }) => {
  const [displayName, setDisplayName] = useState(name);
  const visibleName = showNickname ? nickname : displayName;

  return <input value={visibleName} onChange={(event) => setDisplayName(event.target.value)} />;
};
