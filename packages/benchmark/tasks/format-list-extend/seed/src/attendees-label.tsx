import { formatList } from "./format-list.ts";

interface AttendeesLabelProps {
  names: string[];
}

// Existing consumer (keeps format-list.ts reachable). Do not edit.
export const AttendeesLabel = ({ names }: AttendeesLabelProps) => (
  <span className="attendees">{formatList(names)}</span>
);
