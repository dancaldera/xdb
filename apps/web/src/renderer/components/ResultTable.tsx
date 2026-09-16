import type { ReactElement } from "react";
import { formatCell } from "../lib/format";

export function ResultTable({
  rows,
  truncated
}: {
  rows: Record<string, unknown>[];
  truncated?: boolean;
}): ReactElement {
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="table-scroll">
      {truncated ? (
        <p className="result-truncated-note">
          Showing the first {rows.length.toLocaleString()} rows. Add a LIMIT to narrow the result.
        </p>
      ) : null}
      <table className="data-grid compact">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: duplicate row values are legal in SQL results; the index keeps keys unique.
            <tr key={`${index}:${columns.map((column) => formatCell(row[column])).join(" ")}`}>
              {columns.map((column) => (
                <td key={column}>{formatCell(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
