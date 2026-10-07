// rule: tanstack-start-missing-scripts
// weakness: import-alias
// source: Bugbot review of PR #1451
import Scripts from "@/router-components";
import { createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <html>
      <body>
        <Scripts />
      </body>
    </html>
  ),
});
