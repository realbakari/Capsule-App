/** Fixed-size pages keep even an explicitly expanded diff bounded. */
export const DIFF_PAGE_ROWS = 160;
export const DIFF_PAGE_FILES = 10;

export function DiffPager({ page, pages, onChange, label }: {
  page: number; pages: number; onChange: (page: number) => void; label: string;
}) {
  if (pages <= 1) return null;
  return <nav className="diff-pager" aria-label={label}>
    <span className="faint">{label}</span>
    <button type="button" className="chip" disabled={page === 0} onClick={() => onChange(page - 1)}>Previous</button>
    <label>Page <input aria-label={`${label} page`} type="number" min={1} max={pages} value={page + 1}
      onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= pages) onChange(value - 1); }} /> of {pages}</label>
    <button type="button" className="chip" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}
