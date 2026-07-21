// rule: data-table-requires-accessible-name
// verdict: fail
// weakness: static-semantic-spread

export const Results = () => (
  <table {...{ role: "table", "aria-label": "", hidden: false }}>
    <tbody>
      <tr>
        <th>Name</th>
        <td>Ada</td>
      </tr>
    </tbody>
  </table>
);
