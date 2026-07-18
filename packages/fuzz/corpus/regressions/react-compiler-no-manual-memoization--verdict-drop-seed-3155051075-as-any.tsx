// rule: react-compiler-no-manual-memoization
// kind: verdict-drop
// seed: 3155051075 (iteration 240)
// variant: as-any call receivers

import React from "react";

const mutateReact = () => {
  React.memo = (value: unknown) => value;
};
const AsAnyMemoPanel = (React as any).memo(() => <div />);
AsAnyMemoPanel.propTypes = { value: () => true };

void mutateReact;
