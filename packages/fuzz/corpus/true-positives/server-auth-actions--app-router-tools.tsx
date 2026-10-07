// rule: server-auth-actions
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity (langchain-ai/langchain-nextjs-template)
// verdict: fail
"use server";

import { ChatOpenAI } from "@langchain/openai";

export const executeTool = async (input: string) => {
  const model = new ChatOpenAI({ model: "gpt-4o-mini" });
  return model.stream(input);
};
