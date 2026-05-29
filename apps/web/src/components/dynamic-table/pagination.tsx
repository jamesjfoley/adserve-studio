"use client";

import type { PaginationState } from "./types";

interface PaginationProps {
  pagination: PaginationState;
  onPageChange: (nextOffset: number) => void;
}

const buttonClass =
  "rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--muted)] disabled:opacity-50 disabled:cursor-not-allowed";

export function Pagination({ pagination, onPageChange }: PaginationProps) {
  const { offset, limit, total } = pagination;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <p className="text-[var(--muted-foreground)]">
        {total === 0 ? "0 of 0" : `${start}–${end} of ${total}`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={!canPrev}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          className={buttonClass}
        >
          Previous
        </button>
        <button
          type="button"
          aria-label="Next page"
          disabled={!canNext}
          onClick={() => onPageChange(offset + limit)}
          className={buttonClass}
        >
          Next
        </button>
      </div>
    </div>
  );
}
