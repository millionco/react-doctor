// rule: no-async-event-handler-without-reentry-guard
// verdict: fail
import { useState } from "react";
import api from "example-client";
export const Example = () => {
  const [ready, setReady] = useState(false);
  const send = async (event) => {
    event.preventDefault();
    await (api as any).post("/items").then(() => {
      setReady(true);
    });
  };
  return <form onSubmit={send} />;
};
const Forward = ({ onSend }) => <form onSubmit={onSend} />;
