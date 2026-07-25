// rule: tanstack-start-missing-scripts
// weakness: framework-gating
// source: Bugbot review of PR #1451
import { createRootRoute } from "@tanstack/react-router";

const DemoDocument = () => (
  <html>
    <body>Demo</body>
  </html>
);

export const Route = createRootRoute({
  component: () => <main>Home</main>,
});

export { DemoDocument };
