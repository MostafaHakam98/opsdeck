export function Pager({
  total,
  page,
  size = 20,
  onPage,
}: {
  total: number;
  page: number;
  size?: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(total, page * size)} of ${total}`
          : "0 results"}
      </span>
      {pages > 1 && (
        <div className="inline-actions">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
