// rule: no-async-event-handler-without-reentry-guard
// verdict: pass
import { useState } from "react";
import api from "example-client";
const Example = ({ busy }) => {
  const [ready, setReady] = useState(false);
  const send = async (event) => {
    event.preventDefault();
    if (busy) return;
    await api.post("/items");
    setReady(true);
  };
  return <Forward onSend={send} />;
};
export default Example;
const Forward = ({ onSend }) => <form onSubmit={onSend} />;
