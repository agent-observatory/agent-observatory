import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Home({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const incoming = await searchParams;
  const preserved = new URLSearchParams();

  for (const name of ["session", "connect", "page", "pageSize", "q"] as const) {
    const value = incoming[name];
    if (typeof value === "string" && value) preserved.set(name, value);
  }

  const opensSessionSurface =
    preserved.has("session") || preserved.has("connect");
  const query = preserved.toString();
  // Device pairing and direct-session links still need the session surface.
  redirect(opensSessionSurface ? `/sessions?${query}` : "/wiki");
}
