// rule: only-export-components
// weakness: library-idiom
// source: github.com/daybrush/scena (parity for github.com/millionco/react-doctor/issues/1858)
// verdict: pass
import React from "react";

export const Gate = ({ children }) => React.cloneElement(children, { title: "layer" });
export const Card = () => <Gate>{content}</Gate>;
