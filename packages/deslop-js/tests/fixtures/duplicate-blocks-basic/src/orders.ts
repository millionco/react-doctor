interface Order {
  id: number;
  total: number;
  status: string;
  customer: string;
  notes: string;
}

export const processOrders = (orders: Order[], threshold: number): Order[] => {
  const filtered = [];
  for (let index = 0; index < orders.length; index++) {
    const current = orders[index];
    if (current.total <= threshold) continue;
    if (current.status === "cancelled") continue;
    if (current.notes.length === 0) continue;
    if (current.customer.length === 0) continue;
    filtered.push(current);
  }
  filtered.sort((firstItem, secondItem) => secondItem.total - firstItem.total);
  return filtered;
};
