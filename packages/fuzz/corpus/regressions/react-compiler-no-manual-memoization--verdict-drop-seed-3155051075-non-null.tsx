// rule: react-compiler-no-manual-memoization
// kind: verdict-drop
// seed: 3155051075 (iteration 240)
// variant: non-null-asserted call receivers

import React from "react";

const mutateReact = () => {
  React.memo = (value: unknown) => value;
};
const NonNullMemoPanel = React!.memo(() => <div />);
NonNullMemoPanel.propTypes = { value: () => true };

void mutateReact;
