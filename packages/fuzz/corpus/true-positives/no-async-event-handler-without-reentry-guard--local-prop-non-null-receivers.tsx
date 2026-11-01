// rule: no-async-event-handler-without-reentry-guard
// verdict: fail
import { useState } from "react";
import api from "example-client";
export const Example = () => {
  const [ready, setReady] = useState(false);
  const send = async (event) => {
    event!.preventDefault();
    await api!.post("/items");
    setReady(true);
  };
  return <Forward onSend={send} />;
};
const Forward = ({ onSend }) => <form onSubmit={onSend} />;
