export function Pager({
  total,
  page,
  size = 20,
  onPage,
  label = "Results",
  onSize,
}: {
  total: number;
  page: number;
  size?: number;
  onPage: (page: number) => void;
  label?: string;
  onSize?: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.max(1, Math.min(page, pages));
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span aria-live="polite" aria-atomic="true">
        {total
          ? `${(current - 1) * size + 1}–${Math.min(total, current * size)} of ${total}`
          : "0 results"}
      </span>
      {onSize && (
        <label className="page-size">
          Rows per page
          <select
            aria-label={`${label} rows per page`}
            value={size}
            onChange={(event) => onSize(Number(event.target.value))}
          >
            {[...new Set([5, 10, 20, 50, size])]
              .sort((a, b) => a - b)
              .map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
          </select>
        </label>
      )}
      {pages > 1 && (
        <div className="inline-actions">
          <button
            type="button"
            aria-label="Previous page"
            disabled={current <= 1}
            onClick={() => onPage(current - 1)}
          >
            Previous
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={current >= pages}
            onClick={() => onPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </nav>
  );
}
