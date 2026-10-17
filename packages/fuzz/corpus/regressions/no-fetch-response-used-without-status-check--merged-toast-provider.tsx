// rule: no-fetch-response-used-without-status-check
// verdict: pass
// weakness: erased-provider-shadow
// source: independent synthetic regression
import { toast } from "sonner";
interface toast {}
export const load = async (commit: (value: unknown) => void) => {
  const response = await fetch("/api/records");
  if (response.ok) return;
  const { error } = await response.json();
  toast.error(error);
};
