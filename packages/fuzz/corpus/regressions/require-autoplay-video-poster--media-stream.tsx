// rule: require-autoplay-video-poster
// weakness: library-idiom
// source: react-doctor 0.8.1-to-main all-rules parity, stuyy/chat-platform-react
// verdict: pass

import React from "react";

export const ConversationCall = ({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement> }) => (
  <video ref={videoRef} autoPlay muted playsInline />
);
