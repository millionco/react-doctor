// rule: react-router-resource-link-requires-reload
// weakness: static-expression-and-falsy-escape-prop
// source: Bugbot review of PR #1411
import { createBrowserRouter, Link } from "react-router";

createBrowserRouter([{ path: "/guide.pdf", loader: loadGuide }]);

export const Downloads = () => (
  <>
    <Link to={"/guide.pdf"} reloadDocument={false}>
      Reload
    </Link>
    <Link to={`/guide.pdf`} download={false}>
      Download
    </Link>
  </>
);
