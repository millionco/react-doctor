// rule: data-table-requires-accessible-name
// weakness: descendant-text-alternative
// source: accessibility parity review
// verdict: pass

export const Results = () => (
  <table>
    <caption>
      <img alt="Results" src="/results.svg" />
    </caption>
    <tbody>
      <tr>
        <th>Name</th>
      </tr>
    </tbody>
  </table>
);
