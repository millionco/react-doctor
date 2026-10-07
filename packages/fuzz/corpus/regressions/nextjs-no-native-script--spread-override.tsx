// rule: nextjs-no-native-script
// weakness: spread-override
// source: 0.8.1-to-main all-rules parity deep audit
// verdict: pass

export const AnalyticsDocumentHead = ({ scriptProperties }) => (
  <head>
    <script
      async
      blocking="render"
      type="text/javascript"
      src="https://analytics.example.com/client.js"
      {...scriptProperties}
    />
  </head>
);
