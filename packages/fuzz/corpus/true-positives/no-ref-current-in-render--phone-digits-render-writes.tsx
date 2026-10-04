// rule: no-ref-current-in-render
// verdict: fail
// weakness: control-flow
// source: React Bench usePhoneDigits telemetry-only cohort (36 trials, three unique callsites)

import { useRef } from "react";

interface PhoneState {
  inputValue: string;
  isoCode: string | null;
}

class AsYouType {
  constructor(_country?: string) {}

  input(_value: string): void {}

  reset(): void {}
}

export const usePhoneDigits = ({
  value,
  onChange,
  defaultCountry,
  nextState,
}: {
  value: string;
  onChange: (value: string) => void;
  defaultCountry?: string;
  nextState: PhoneState;
}) => {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const asYouTypeRef = useRef(new AsYouType(defaultCountry));
  const previousCountryRef = useRef<string | null>(defaultCountry ?? null);

  if (value !== nextState.inputValue) {
    asYouTypeRef.current = new AsYouType(defaultCountry);
    asYouTypeRef.current.reset();
    asYouTypeRef.current.input(nextState.inputValue);
    previousCountryRef.current = nextState.isoCode;
  }

  return previousCountryRef.current;
};
