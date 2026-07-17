// rule: no-clipped-overlay
// weakness: variant-scope
// source: Bugbot review on PR #850

export const ResponsiveMenu = () => (
  <div className="md:overflow-hidden">
    <div role="menu" className="absolute">
      Menu
    </div>
  </div>
);
