import { truncateMiddle } from "./truncate-middle.ts";

interface FileChipProps {
  fileName: string;
}

// Existing consumer (keeps truncate-middle.ts reachable). Do not edit.
export const FileChip = ({ fileName }: FileChipProps) => (
  <span className="file-chip">{truncateMiddle(fileName, 20)}</span>
);
