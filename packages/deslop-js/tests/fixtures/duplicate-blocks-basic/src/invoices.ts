interface Invoice {
  id: number;
  amount: number;
  state: string;
  vendor: string;
  memo: string;
}

export const processInvoices = (invoices: Invoice[], minAmount: number): Invoice[] => {
  const accepted = [];
  for (let cursor = 0; cursor < invoices.length; cursor++) {
    const entry = invoices[cursor];
    if (entry.amount <= minAmount) continue;
    if (entry.state === "cancelled") continue;
    if (entry.memo.length === 0) continue;
    if (entry.vendor.length === 0) continue;
    accepted.push(entry);
  }
  accepted.sort((leftEntry, rightEntry) => rightEntry.amount - leftEntry.amount);
  return accepted;
};
