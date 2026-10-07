// rule: data-table-requires-accessible-name
// weakness: static-spread-precision
// source: final adversarial parity review
// verdict: fail

const tableProperties = { className: "results", "data-kind": "report" };

export const Results = () => (
  <table {...tableProperties}>
    <tbody>
      <tr>
        <th>Name</th>
        <td>Ada</td>
      </tr>
    </tbody>
  </table>
);
