// rule: no-repeating-gradient-decoration
// weakness: data-visualization-context
// source: PR #1337 all-rules RDE parity (PostHog/posthog)
export const DistributionChart = () => (
  <Chart>
    <div
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, var(--data-color) 0 6px, transparent 6px 12px)",
      }}
    />
  </Chart>
);
