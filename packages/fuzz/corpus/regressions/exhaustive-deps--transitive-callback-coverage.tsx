import * as React from "react";

export const Panel = ({ active }: { active: boolean }) => {
  const value = active;
  const carrier = React.useCallback(() => value, [value]);

  React.useEffect(() => {
    document.title = String(value) + ":" + String(carrier());
  }, [carrier]);

  return null;
};
