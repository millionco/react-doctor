// rule: jsx-key
// weakness: rendering-call-provenance
// source: Cursor Bugbot discussion 3608281208 on PR #1388
import React from "react";

interface ItemProps {
  value: string;
}

const Item = ({ value }: ItemProps) => <li>{value}</li>;
const List = ({ children }: React.PropsWithChildren) => <ul>{children}</ul>;

export const CreateElementList = () =>
  React.createElement(List, null, [<Item value="one" />, <Item value="two" />]);
