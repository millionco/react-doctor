import { useOptimistic, useState } from "react";

export const MessageForm = () => {
  const [confirmedMessages, setConfirmedMessages] = useState<ReadonlyArray<string>>([]);
  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    confirmedMessages,
    (pendingMessages, message: string) => [...pendingMessages, message],
  );
  const submitAction = () => {
    addOptimisticMessage("Sent");
    setConfirmedMessages((previousMessages) => [...previousMessages, "Sent"]);
  };
  const formProperties = { action: submitAction };
  const renderForm = () => (
    <form {...formProperties}>
      <button type="submit">Send</button>
      <output>{optimisticMessages.length}</output>
    </form>
  );

  return renderForm();
};
