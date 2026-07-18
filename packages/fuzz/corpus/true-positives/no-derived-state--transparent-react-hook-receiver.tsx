// rule: no-derived-state
// weakness: wrapper-transparency
// source: fuzz verdict-drop seed 1000113
import * as React from "react";

export const MirroredDraft = ({ value }: { value: string }) => {
  const [draft, setDraft] = (React as any).useState("");

  React!.useEffect(() => {
    setDraft(value);
  }, [value]);

  return <output>{draft}</output>;
};
