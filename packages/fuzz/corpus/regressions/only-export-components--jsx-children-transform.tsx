// rule: only-export-components
// weakness: library-idiom
// source: github.com/CopilotKit/CopilotKit (parity for github.com/millionco/react-doctor/issues/1858)
// verdict: pass
import React, { useMemo } from "react";

export const Gate = ({ children }) =>
  useMemo(() => React.Children.map(children, (child) => React.cloneElement(child)), [children]);
export const Card = () => <Gate>{content}</Gate>;
