import React from "react";

export const makeDefaultRenderValue = <Value,>(compute: () => Value): Value =>
  React.useState(() => compute())[0];
