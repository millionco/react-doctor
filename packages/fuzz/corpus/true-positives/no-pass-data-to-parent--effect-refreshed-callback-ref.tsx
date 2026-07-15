// rule: no-pass-data-to-parent
// weakness: control-flow
// source: React Bench fix-react-rdh-kaihotz-react-phon__8hmcKDm
import { useEffect, useRef } from "react";

interface PhoneInputProps {
  onChange: (value: string) => void;
}

export const PhoneInput = ({ onChange }: PhoneInputProps) => {
  const phoneNumber = usePhoneNumber();
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onChangeRef.current(phoneNumber);
  }, [phoneNumber]);

  return null;
};
