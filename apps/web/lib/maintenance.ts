import { db } from "./db";
import { storage } from "./storage";
import { dispatchJob } from "./dispatch";
export async function maintenance() {
  await db()`SELECT 1`;
  const started = Date.now();
  let deletedObjects = 0;
  while (Date.now() - started < 180000) {
    const expired =
      await db()`SELECT b.owner,b.id,b.path FROM atlas.batches b JOIN atlas.sessions s ON s.id=b.session_id WHERE (s.expires_at<=now() OR s.deleted) AND b.purged=false LIMIT 100`;
    if (!expired.length) break;
    const { error } = await storage().remove(expired.map((x) => x.path));
    if (error) throw new Error("Storage deletion failed");
    await db()`UPDATE atlas.batches SET purged=true WHERE path IN ${db()(expired.map((x) => x.path))}`;
    deletedObjects += expired.length;
  }
  // Reconcile a Storage write whose following DB transaction failed.
  // The one-hour grace excludes in-flight ingests.
  const orphans =
    await db()`SELECT name FROM storage.objects o WHERE bucket_id='sessions' AND created_at<now()-interval '1 hour' AND NOT EXISTS(SELECT 1 FROM atlas.batches b WHERE b.path=o.name) LIMIT 500`;
  if (orphans.length) {
    const { error } = await storage().remove(orphans.map((x) => x.name));
    if (error) throw new Error("Orphan deletion failed");
    deletedObjects += orphans.length;
  }
  await db().begin(async (sql) => {
    await sql`DELETE FROM atlas.job_items WHERE expires_at<=now()`;
    await sql`DELETE FROM atlas.batches WHERE purged=true AND session_id IN (SELECT id FROM atlas.sessions WHERE expires_at<=now() OR deleted)`;
    // Deleted session rows remain until the original detailed-data expiry,
    // blocking re-ingestion without extending the 7-day window.
    await sql`DELETE FROM atlas.sessions s WHERE expires_at<=now() AND NOT EXISTS(SELECT 1 FROM atlas.batches b WHERE b.session_id=s.id) AND NOT EXISTS(SELECT 1 FROM atlas.job_items i WHERE i.session_id=s.id)`;
    await sql`DELETE FROM atlas.summaries WHERE expires_at<=now()`;
    await sql`DELETE FROM atlas.jobs j WHERE created_at<now()-interval '7 days' OR NOT EXISTS(SELECT 1 FROM atlas.job_items i WHERE i.job_id=j.id)`;
    await sql`DELETE FROM atlas.pairings WHERE expires_at<=now()`;
    await sql`DELETE FROM atlas.devices WHERE owner IS NULL AND created_at<now()-interval '1 day'`;
    await sql`DELETE FROM atlas.users u WHERE guest=true AND created_at<now()-interval '30 days' AND NOT EXISTS(SELECT 1 FROM atlas.summaries s WHERE s.owner=u.id) AND NOT EXISTS(SELECT 1 FROM atlas.sessions s WHERE s.owner=u.id)`;
    await sql`DELETE FROM atlas.rate_limits WHERE created_at<now()-interval '2 days'`;
    await sql`DELETE FROM atlas.schedule_runs WHERE created_at<now()-interval '7 days'`;
    await sql`DELETE FROM atlas.leases WHERE expires_at<=now()`;
  });
  const pending =
    await db()`SELECT id FROM atlas.jobs WHERE run_id IS NULL AND created_at>now()-interval '3 days' ORDER BY created_at LIMIT 10`;
  for (const job of pending) await dispatchJob(job.id);
  return { checked: true, deletedObjects, recoveredDispatches: pending.length };
}
