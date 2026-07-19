// rule: no-async-event-handler-without-reentry-guard
// weakness: alias-guard
import { useState } from "react";

export const SaveButton = () => {
  const [, setSaved] = useState(false);
  let handleSave = async () => {
    await api.post("/save");
    setSaved(true);
  };
  handleSave = async () => {};
  return <button onClick={handleSave}>Save</button>;
};
