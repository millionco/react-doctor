// rule: no-derived-state
// weakness: control-flow
// source: synthetic regression
// verdict: pass
import React from "react";

export const Announcement = React.memo((props: { message?: string }) => {
  const { message } = props;
  const [visible, setVisible] = React.useState(message);
  React.useEffect(() => {
    if (!message) return;
    setVisible(message);
  }, [message]);
  if (!visible) return null;
  return <p>{visible}</p>;
});
