// rule: nextjs-no-redirect-in-try-catch
// verdict: pass
// Source: issue #1810 and PR #1811 review.
// Weakness: Framework rethrows must forward the actual caught binding.
import { redirect, unstable_rethrow } from "next/navigation";
export function Page() {
  try {
    redirect("/done");
  } catch (error) {
    unstable_rethrow(error);
  }
}
