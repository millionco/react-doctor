// rule: no-italic-serif-display-heading
// weakness: variant-scope
// source: Bugbot review on PR #850

export const ResponsiveEditorialHeading = () => (
  <h1 className="font-serif dark:italic md:text-7xl">A considered approach</h1>
);
