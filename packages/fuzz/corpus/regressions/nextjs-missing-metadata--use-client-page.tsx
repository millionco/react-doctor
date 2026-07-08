// rule: nextjs-missing-metadata
// weakness: framework-gating
// source: fresh modern-corpus FP hunt ("use client" pages cannot export metadata)
"use client";

import { useState } from "react";

export default function ChatPage() {
  const [messages, setMessages] = useState<string[]>([]);
  return (
    <main>
      <button type="button" onClick={() => setMessages((previous) => [...previous, "hi"])}>
        Send
      </button>
      <ul>
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </main>
  );
}
