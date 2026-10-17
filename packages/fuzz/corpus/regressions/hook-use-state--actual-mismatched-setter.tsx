// rule: hook-use-state
// verdict: fail
// weakness: library-idiom
// source: synthetic actual setter naming remains enforced
import { useState } from "react";

export const useEditableMarker = () => {
  const [editableMarker, replaceMarker] = useState("initial");
  return { editableMarker, replaceMarker };
};
