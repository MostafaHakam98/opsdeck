import { useState, type ReactNode } from "react";
import { Pager } from "./Pager";

/** Keep paging local to a list; live refreshes preserve the current position. */
export function PaginatedList<T = any>({
  items,
  label,
  children,
  initialSize = 10,
  resetKey = "",
  empty,
}: {
  items: readonly T[];
  label: string;
  children: (rows: T[]) => ReactNode;
  initialSize?: number;
  resetKey?: string | number;
  empty?: ReactNode;
}) {
  const [position, setPosition] = useState({
    page: 1,
    size: initialSize,
    resetKey,
  });
  const page = Math.min(
    position.resetKey === resetKey ? position.page : 1,
    Math.max(1, Math.ceil(items.length / position.size)),
  );
  // Adjust together so a changed filter or smaller live result never shows an
  // obsolete page, including if the collection subsequently grows again.
  if (position.resetKey !== resetKey || position.page !== page) {
    setPosition({ ...position, page, resetKey });
  }
  return (
    <div className="paginated-list" role="group" aria-label={label}>
      {items.length
        ? children(
            items.slice((page - 1) * position.size, page * position.size),
          )
        : (empty ?? (
            <p className="list-empty">
              No records available for this selection.
            </p>
          ))}
      <Pager
        total={items.length}
        page={page}
        size={position.size}
        label={label}
        onPage={(next) => setPosition({ ...position, page: next })}
        onSize={(size) => setPosition({ ...position, size, page: 1 })}
      />
    </div>
  );
}
