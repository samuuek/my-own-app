export type ReadingStats = {
  completion: number | null;
  pagesRead: number;
  minutesRead: number;
  noteCount: number;
  lastReadAt: string | null;
};

export class ReadingValidationError extends Error {
  statusCode = 400;
}

export function validateBookProgress(currentPage: number, totalPages: number | null): void {
  if (!Number.isInteger(currentPage) || currentPage < 0) throw new ReadingValidationError("当前页不能小于 0");
  if (totalPages !== null && (!Number.isInteger(totalPages) || totalPages <= 0)) throw new ReadingValidationError("总页数必须大于 0");
  if (totalPages !== null && currentPage > totalPages) throw new ReadingValidationError("当前页不能超过总页数");
}

export function calculateReadingStats(
  book: Record<string, any>,
  sessions: Array<Record<string, any>>,
  notes: Array<Record<string, any>>,
): ReadingStats {
  const totalPages = Number(book.total_pages) || null;
  const currentPage = Number(book.current_page) || 0;
  return {
    completion: totalPages ? Math.min(100, Math.round((currentPage / totalPages) * 100)) : null,
    pagesRead: sessions.reduce((sum, session) => sum + Math.max(0, Number(session.end_page) - Number(session.start_page) + 1), 0),
    minutesRead: sessions.reduce((sum, session) => sum + Math.max(0, Number(session.duration_minutes) || 0), 0),
    noteCount: notes.length,
    lastReadAt: book.last_read_at ?? null,
  };
}
