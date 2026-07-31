// rule: no-side-effect-in-state-updater-function
// weakness: alias-guard
// source: Cursor Bugbot PR #1525

import { useState } from "react";

interface SetterProps {
  setMessages: (messages: string[]) => void;
}

const noop = () => {};

export const MemberSetterProp = (props: SetterProps) => {
  const [, setMessages] = useState<string[]>([]);
  setMessages((previous) => {
    props.setMessages(previous);
    return previous;
  });
  return null;
};

export const DefaultedSetterProp = ({
  setGroupState = noop,
}: {
  setGroupState?: (group: string) => void;
}) => {
  const [, setOpen] = useState(false);
  setOpen((previous) => {
    setGroupState("group");
    return !previous;
  });
  return null;
};
