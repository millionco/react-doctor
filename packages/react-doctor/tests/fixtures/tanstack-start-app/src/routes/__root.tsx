const createRootRoute = (options: any) => options;
const Outlet = () => <div />;
const Scripts = () => <script />;

export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
