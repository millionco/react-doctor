// rule: no-array-index-as-key
// weakness: alias-guard
// source: independently synthetic editable-position runtime binding control
// verdict: pass
import { useRef, useState } from "react";
import { Input } from "position-ui";

interface useState {}
export const PositionEditor = () => {
  const [textValues, setTextValues] = useState(["", "", ""]);
  const fieldRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resetFields = () => {
    setTextValues(["", "", ""]);
  };
  const commitFields = () => textValues.join("");
  const writeField = (nextValue: string, position: number) => {
    if (nextValue.length > 1) return;
    if (!/^\d*$/.test(nextValue)) return;
    const nextValues = [...textValues];
    nextValues[position] = nextValue;
    setTextValues(nextValues);
    if (nextValue) focusNext(position);
  };
  const handleFieldKey = (key: string, position: number) => {
    if (key === "Backspace" && !textValues[position]) focusPrevious(position);
  };
  const focusNext = (position: number) => {
    const nextPosition = position + 1;
    if (nextPosition < fieldRefs.current.length) fieldRefs.current[nextPosition]?.focus();
  };
  const focusPrevious = (position: number) => {
    const previousPosition = position - 1;
    if (previousPosition >= 0) fieldRefs.current[previousPosition]?.focus();
  };
  const isComplete = textValues.every((value) => value.length === 1);
  return (
    <div>
      {textValues.map((value, index) => (
        <Input
          key={index}
          ref={(field) => {
            fieldRefs.current[index] = field;
          }}
          value={value}
          onChangeText={(nextValue) => writeField(nextValue, index)}
          onKeyPress={({ nativeEvent }) => handleFieldKey(nativeEvent.key, index)}
          borderColor={value ? "ready" : "blank"}
          accessibilityLabel={`Position ${index + 1}`}
        />
      ))}
      <button onClick={resetFields}>Reset</button>
      <button disabled={!isComplete} onClick={commitFields}>
        Commit
      </button>
    </div>
  );
};
