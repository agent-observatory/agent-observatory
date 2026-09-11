import { Atlas } from "../../components/atlas";
import { sessionPage } from "../../lib/pagination";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const incoming = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["page", "pageSize", "q"])
    if (typeof incoming[key] === "string") params.set(key, incoming[key]);
  return (
    <Atlas
      view="sessions"
      listing={sessionPage("https://atlas.local/?" + params.toString())}
    />
  );
}
