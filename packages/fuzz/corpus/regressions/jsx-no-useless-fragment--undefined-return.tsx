// rule: jsx-no-useless-fragment
// weakness: undefined-return
// source: synthetic optional render value
import React from "react";

export const OptionalLabel = React.memo(({ label }: { label?: React.ReactNode }) => <>{label}</>);

export const OptionalContent = ({ entry }: { entry: { visible?: boolean } }) => (
  <>{entry.visible && <span>Content</span>}</>
);
