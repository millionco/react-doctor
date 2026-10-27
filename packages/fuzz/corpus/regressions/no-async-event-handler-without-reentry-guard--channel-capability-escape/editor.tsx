// rule: no-async-event-handler-without-reentry-guard
// weakness: cross-file
// source: Synthetic channel method replacement through an own capability consumer
// verdict: pass
import { useState } from "react";
import { useChatContext } from "stream-chat-react";

export const Editor = () => {
  const { channel } = useChatContext();
  const replaceMutation = (target) => {
    target.update = async () => {};
  };
  replaceMutation(channel);
  const selected = channel;
  const [label, setLabel] = useState("");
  const save = async () => {
    await selected.update({ name: label });
    setLabel("");
  };
  return (
    <div>
      <input value={label} onChange={(event) => setLabel(event.target.value)} />
      <button type="button" onClick={save}>
        Update
      </button>
    </div>
  );
};
