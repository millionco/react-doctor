import { useState } from "react";

export const makeRenderValue = <Value,>(compute: () => Value): Value =>
  useState(() => compute())[0];
