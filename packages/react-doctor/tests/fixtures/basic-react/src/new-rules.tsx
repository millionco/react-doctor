import { useEffect } from "react";

declare const fetchData: () => Promise<unknown>;

export const DynamicImportPath = async (moduleName: string) => {
  const mod = await import(moduleName);
  return mod;
};

export const DynamicRequirePath = (moduleName: string) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(moduleName);
  return mod;
};

interface Item {
  deeply: {
    nested: {
      value: number;
      label: string;
    };
  };
}

export const cachePropertyAccessHotLoop = (items: Item[]): number => {
  let total = 0;
  for (const item of items) {
    total += item.deeply.nested.value;
    if (item.deeply.nested.value > 100) total += item.deeply.nested.value;
    console.log(item.deeply.nested.label);
  }
  return total;
};

export const lengthCheckFirst = (a: number[], b: number[]): boolean =>
  a.every((value, index) => value === b[index]);

export const intlInRender = (amount: number, locale: string): string => {
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency: "USD" });
  return formatter.format(amount);
};

const useEffectEvent = <T,>(handler: T): T => handler;

export const EffectEventInDeps = ({ value }: { value: number }) => {
  const onChange = useEffectEvent((next: number) => {
    console.log(next, value);
  });
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  return null;
};

export const EnormousJsx = () => {
  const StaticHero = (
    <header>
      <h1>Welcome</h1>
      <p>Sign up to learn more.</p>
    </header>
  );
  return <main>{StaticHero}</main>;
};

interface ManyBoolProps {
  isPrimary?: boolean;
  isDisabled?: boolean;
  isLoading?: boolean;
  hasIcon?: boolean;
  showLabel?: boolean;
  canEdit?: boolean;
}

export const FlagsButton = ({
  isPrimary,
  isDisabled,
  isLoading,
  hasIcon,
  showLabel,
  canEdit,
}: ManyBoolProps) => {
  void fetchData;
  void [isPrimary, isDisabled, isLoading, hasIcon, showLabel, canEdit];
  return <button>{"Save"}</button>;
};
