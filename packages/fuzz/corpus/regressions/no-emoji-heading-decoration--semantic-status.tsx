// rule: no-emoji-heading-decoration
// weakness: library-idiom
// source: PR #1337 detector audit

const StatusHeading = () => (
  <h2>
    Deployment complete <span>✅</span>
  </h2>
);

export default StatusHeading;
