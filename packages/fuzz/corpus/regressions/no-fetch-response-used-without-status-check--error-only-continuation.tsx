// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: independently-authored-public-synthetic
// verdict: pass
import { toast } from "sonner";
export const loadRecord = async () => {
  const response = await fetch("/api/records");
  if (response.ok) return response.json();
  const { error } = await response.json();
  toast.error(error);
};
