// rule: nextjs-no-native-script
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity deep audit
// verdict: fail

import DocumentHead from "next/head";

export const AnalyticsDocumentHead = () => (
  <DocumentHead>
    <script
      {...scriptProperties}
      async
      blocking="render"
      type="text/javascript"
      src="https://analytics.example.com/client.js"
    />
  </DocumentHead>
);
