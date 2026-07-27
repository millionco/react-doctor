import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VideoWorkspace } from "./video-workspace";
import "./style.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The video workspace root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <VideoWorkspace />
  </StrictMode>,
);
