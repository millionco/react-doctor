// rule: no-fetch-response-used-without-status-check
// verdict: fail
// weakness: provider-rewrite
// source: independent synthetic regression
import { toast } from "sonner";
export const load = async (commit: (value: unknown) => void) => {
  require("sonner").toast.error = commit;
  const response = await fetch("/api/records");
  if (response.ok) return;
  const { error } = await response.json();
  toast.error(error);
};
