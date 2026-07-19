import { AbsoluteFill } from "remotion";

interface StudioPreviewProps {
  source: string;
}

export const StudioPreview = ({ source }: StudioPreviewProps) => (
  <AbsoluteFill>
    <video src={source} />
  </AbsoluteFill>
);
