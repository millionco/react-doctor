// rule: rendering-conditional-render
// verdict: fail
// weakness: provider-erasure
// source: synthetic
import type require = require("provider-types");
require("react").useState = () => [0, () => {}];
import { useState } from "react";
export const Example = (input: unknown) => {
  const [resultSize, setResultSize] = useState("");

  return <section>{resultSize && <output>{resultSize}</output>}</section>;
};
