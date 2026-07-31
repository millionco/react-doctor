// verdict: pass
// rule: js-hoist-intl
// weakness: framework-gating
// source: ReactBench Cloudscape format-date-localized

export const formatDateLocalized = ({ date, locale }: { date: Date; locale?: string }) => {
  const formattedDate = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const formattedTime = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formattedDate} ${formattedTime}`;
};
