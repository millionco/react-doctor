// rule: no-boolean-toggle-without-functional-update
// weakness: alias-guard
// source: Cursor Bugbot review on PR #1383

import { useState } from "react";

export const MuteButton = ({ player }) => {
  const [muted, setMuted] = useState(false);
  const mirrorCommand = () => setMuted(!muted);
  const toggle = () => player.setMuted(!muted).then(mirrorCommand);
  return <button onClick={toggle}>{muted ? "Unmute" : "Mute"}</button>;
};
