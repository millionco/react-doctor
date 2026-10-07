// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: control-flow
// source: PR #1525 Bugbot review

import { useEffect, useState } from "react";

export const NestedComponentObjectHelper = () => {
  const [, setValue] = useState(0);
  const helpers = {
    saveValue: (value: number) => value + 1,
  };
  const onClick = () => setValue((previous) => helpers.saveValue(previous));
  useEffect(() => {
    setValue((previous) => helpers.saveValue(previous));
  }, []);
  return <button onClick={onClick} />;
};
