import { chunkize } from "./chunk.ts";

interface PhotoGridProps {
  urls: string[];
}

// Existing consumer (keeps chunk.ts reachable). Do not edit.
export const PhotoGrid = ({ urls }: PhotoGridProps) => (
  <div className="grid">
    {chunkize(urls, 3).map((row, rowIndex) => (
      <div className="row" key={rowIndex}>
        {row.length}
      </div>
    ))}
  </div>
);
