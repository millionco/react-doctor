// rule: nextjs-missing-metadata
// weakness: framework-gating
// source: brain doctor PR #83
import { redirect } from "next/navigation";

const ChangelogRedirect = () => redirect("/docs/community/changelog");

export default ChangelogRedirect;
