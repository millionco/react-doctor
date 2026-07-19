// rule: server-auth-actions
// weakness: name-heuristic
// source: chaibuilder/sdk frameworks/nextjs/package/rsc/json-ld.tsx

"use server";

import { withDataBinding } from "../lib/with-data-binding";

interface JsonLdProps {
  jsonLD?: string;
  pageData?: Record<string, unknown>;
}

export const JSONLD = async ({ jsonLD, pageData = {} }: JsonLdProps) => {
  if (!jsonLD) return null;
  const jsonLDString = withDataBinding(jsonLD, pageData);
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLDString }} />;
};
