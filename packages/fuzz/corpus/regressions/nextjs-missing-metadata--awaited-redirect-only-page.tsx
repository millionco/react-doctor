// rule: nextjs-missing-metadata
// weakness: transparent-expression
// source: Cursor Bugbot discussion 3608287736 on PR #1388
import { permanentRedirect as movePermanently } from "next/navigation";

const LegacyRedirect = async () => await movePermanently("/docs");

export default LegacyRedirect;
