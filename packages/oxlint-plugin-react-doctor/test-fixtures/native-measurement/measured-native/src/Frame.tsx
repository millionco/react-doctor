import { useRelay } from "src/useRelay";
const defaults = { className: "", delta: 0, onSwiping: () => {}, onSwiped: () => {} };
const Frame = (props: any) => {
  const { children, className, delta, onSwiping, onSwiped } = { ...defaults, ...props };
  const { ref } = useRelay({ delta, onSwiping, onSwiped });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
};
export default Frame;
