// rule: react-router-no-invalid-splat-path
// weakness: wrapper-transparency
// source: Bugbot review of PR #1411
import { createBrowserRouter } from "react-router";

createBrowserRouter([{ path: "/files/*/edit" as const, element: <Editor /> }]);
