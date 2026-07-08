// rule: exhaustive-deps
// weakness: copy-tracking
// source: corpus census triage (guangzhengli/vectorhub ChatInput — prop ref autosize effect)
import { useEffect } from "react";

export const AutosizeTextarea = ({
  textareaRef,
  content,
}: {
  textareaRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  content: string;
}) => {
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "inherit";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content, textareaRef]);
  return <textarea ref={textareaRef} value={content} readOnly />;
};
