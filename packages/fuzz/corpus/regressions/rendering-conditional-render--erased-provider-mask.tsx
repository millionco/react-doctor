// rule: rendering-conditional-render
// verdict: fail
// weakness: provider-erasure
// source: synthetic
declare const require: any;
require("react").useState = () => [0, () => {}];
import { useState } from "react";
export const Example = (input: unknown) => {
  const [resultSize, setResultSize] = useState("");

  return <section>{resultSize && <output>{resultSize}</output>}</section>;
};
