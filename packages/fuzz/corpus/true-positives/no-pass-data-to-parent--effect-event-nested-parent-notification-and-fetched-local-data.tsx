// rule: no-pass-data-to-parent
// weakness: wrapper-transparency
// source: Synthetic native parity regression
import { useEffect, useEffectEvent, useState } from "react";
import { fetchRows } from "data-service";
export function Child({ setLoading }) {
  const [rows, setRows] = useState([]);
  async function loadRows() {
    const nextRows = await fetchRows();
    setRows(nextRows);
  }
  const init = useEffectEvent(() => {
    async function loadData() {
      await loadRows();
      setLoading(false);
    }
    void loadData();
  });
  useEffect(() => {
    return init();
  }, []);
  return null;
}
