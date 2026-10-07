// rule: no-event-handler
// verdict: pass
// weakness: external-synchronization
// source: React Bench write-react-xr843-fojin-775__w6mMqoi
import { useEffect, useRef, useState } from "react";

interface Message {
  id: number;
}

export const FeedbackList = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const feedbackStateRef = useRef(new Map<number, { pending: Map<number, string> }>());

  useEffect(() => {
    for (const message of messages) {
      if (feedbackStateRef.current.has(message.id)) continue;
      feedbackStateRef.current.set(message.id, { pending: new Map() });
    }
    for (const id of feedbackStateRef.current.keys()) {
      if (!messages.some((message) => message.id === id)) {
        feedbackStateRef.current.delete(id);
      }
    }
  }, [messages]);

  return <button onClick={() => setMessages([{ id: 1 }])}>Load</button>;
};
