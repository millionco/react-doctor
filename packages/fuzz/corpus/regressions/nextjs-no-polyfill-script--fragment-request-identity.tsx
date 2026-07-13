// rule: nextjs-no-polyfill-script
// weakness: other
// source: ISSUES_TO_FIX_ASAP.md V28 URL-fragment request-identity report
export const AnalyticsScript = () => (
  <script defer src="/analytics.js#https://polyfill.io/v3/polyfill.min.js" />
);
