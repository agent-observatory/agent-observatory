export const SESSION_PAGE_SIZES = [10, 20, 50, 100] as const;
export const MAX_SESSION_PAGE = 1_000_000;

export function sessionPage(url: string) {
  const params = new URL(url).searchParams;
  const requestedPage = Number(params.get("page") || 1);
  const requestedSize = Number(params.get("pageSize") || 20);
  return {
    page:
      Number.isInteger(requestedPage) && requestedPage > 0
        ? Math.min(requestedPage, MAX_SESSION_PAGE)
        : 1,
    pageSize: SESSION_PAGE_SIZES.includes(requestedSize as any)
      ? requestedSize
      : 20,
    q: (params.get("q") || "").trim().slice(0, 200),
  };
}

export function sessionPagination(
  page: number,
  pageSize: number,
  total: number,
) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(page, totalPages), pageSize, total, totalPages };
}
