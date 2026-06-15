export interface ScannedIssue {
  message: string;
  severity: "error" | "warning" | "ok";
  pointsLost: number;
  file: string;
}

export interface VideoContent {
  scanTitle: string;
  fixPrompt: string;
  scannedIssues: ScannedIssue[];
}

export interface SceneProps {
  content: VideoContent;
}
