export interface FormatMoneyOptions {
  // ISO 4217 currency code, e.g. "USD", "EUR", "JPY". Defaults to "USD".
  currency?: string;
  // When true, drop the fractional part for whole amounts ($10 instead of $10.00).
  trimZeroCents?: boolean;
}

interface CurrencyFormat {
  symbol: string;
  fractionDigits: number;
}

const CURRENCY_FORMATS: Record<string, CurrencyFormat> = {
  USD: { symbol: "$", fractionDigits: 2 },
  EUR: { symbol: "€", fractionDigits: 2 },
  GBP: { symbol: "£", fractionDigits: 2 },
  JPY: { symbol: "¥", fractionDigits: 0 },
};

const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const resolveFormat = (currency: string): CurrencyFormat => {
  const known = CURRENCY_FORMATS[currency];
  if (known) return known;
  return { symbol: `${currency} `, fractionDigits: 2 };
};

export const formatMoney = (amountCents: number, options: FormatMoneyOptions = {}): string => {
  const currency = (options.currency ?? "USD").toUpperCase();
  const format = resolveFormat(currency);
  const isNegative = amountCents < 0;
  const absoluteCents = Math.abs(amountCents);

  if (format.fractionDigits === 0) {
    const whole = groupThousands(String(absoluteCents));
    return `${isNegative ? "-" : ""}${format.symbol}${whole}`;
  }

  const divisor = 10 ** format.fractionDigits;
  const major = Math.floor(absoluteCents / divisor);
  const minor = absoluteCents % divisor;
  const groupedMajor = groupThousands(String(major));
  const showDecimals = !(options.trimZeroCents && minor === 0);
  const fraction = showDecimals ? `.${String(minor).padStart(format.fractionDigits, "0")}` : "";

  return `${isNegative ? "-" : ""}${format.symbol}${groupedMajor}${fraction}`;
};
