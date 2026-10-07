// rule: display-name
// verdict: fail
// weakness: render-output

import { useMemo } from "react";

export const createView = () => () => useMemo(() => <span>Content</span>, []);
