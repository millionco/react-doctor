// rule: interactive-supports-focus
// weakness: control-flow
// source: React Bench write-react-frankchen021-datasto__GC3spRj

export const ChatInput = ({ isRunning, handleKeyDown }) => (
  <div role="textbox" contentEditable={!isRunning} onKeyDown={handleKeyDown} />
);
