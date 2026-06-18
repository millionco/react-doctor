export const formatDate = (date: Date) => date.toISOString();
export const formatNumber = (num: number) => num.toLocaleString();
export const internalOnly = () => "not re-exported by name but via star";
