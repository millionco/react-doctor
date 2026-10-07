// rule: tanstack-start-missing-scripts
// weakness: wrapper-transparency
// source: Bugbot review of PR #1451
import { createRootRoute, Scripts } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => {
    const scripts = <Scripts />;
    return (
      <html>
        <body>{scripts}</body>
      </html>
    );
  },
});
