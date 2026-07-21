// rule: server-auth-actions
// weakness: binding-provenance
// source: 0.8.1-to-main all-rules parity review
// verdict: pass
"use server";

import { ChatOpenAI } from "@langchain/openai";

export const normalizeRequest = async (formData: FormData, input: string) => {
  formData.set("name", "Ada");
  let model = new ChatOpenAI({ model: "gpt-4o-mini" });
  model = publicFeed;
  return model.invoke(input);
};
