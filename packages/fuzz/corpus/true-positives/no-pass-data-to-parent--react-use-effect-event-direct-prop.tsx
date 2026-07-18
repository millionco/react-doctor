// rule: no-pass-data-to-parent, no-pass-live-state-to-parent, no-prop-callback-in-effect
// weakness: wrapper-transparency
// source: React Bench fix-react-rdh-kaihotz-react-phon__rwZwgmx
import { useEffect, useEffectEvent } from "react";

interface PhoneInputProps {
  format: string;
  initialCountry: string;
  initialValue: string;
  onChange: (value: string | { country: string; phoneNumber: string }) => void;
  withCountryMeta: boolean;
}

declare const usePhonenumber: (options: {
  format: string;
  initialCountry: string;
  initialValue: string;
}) => {
  country: string;
  phoneNumber: string;
};

export const PhoneInput = ({
  format,
  initialCountry,
  initialValue,
  onChange,
  withCountryMeta,
}: PhoneInputProps) => {
  const { country, phoneNumber } = usePhonenumber({ format, initialCountry, initialValue });
  const notifyParent = useEffectEvent(onChange);

  useEffect(() => {
    const data = withCountryMeta ? { country, phoneNumber } : phoneNumber;
    notifyParent(data);
  }, [country, phoneNumber, withCountryMeta]);

  return null;
};
