// rule: react-router-resource-link-requires-reload
// weakness: route-provenance
// source: adversarial contract audit of PR #1411
import { createBrowserRouter, Link } from "react-router";

createBrowserRouter([{ path: "/release-notes.pdf", element: <ReleaseNotes /> }]);

export const Navigation = () => <Link to="/release-notes.pdf">Release notes</Link>;
