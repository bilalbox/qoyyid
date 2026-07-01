import type { Env } from "./types";
import { pollBatchStatus } from "./mistral";
import { finalizeJob, markJobFailed } from "./merge";

interface PendingJob {
  id: string;
  mistral_batch_job_id: string;
  status: string;
}

/**
 * Polls Mistral for jobs in batch_submitted/batch_running status and
 * advances their lifecycle. Runs on a Cloudflare Cron Trigger (wrangler.toml
 * [triggers]) rather than being driven by client polling, since Mistral's
 * batch API has no push/webhook notification and the client only reads job
 * status, never drives server-side transitions.
 */
async function pollOne(env: Env, job: PendingJob): Promise<void> {
  try {
    const batchStatus = await pollBatchStatus(env, job.mistral_batch_job_id);
    if (batchStatus.status === "SUCCESS") {
      await finalizeJob(env, job.id, batchStatus);
    } else if (batchStatus.status === "FAILED" || batchStatus.status === "CANCELLED") {
      await markJobFailed(env, job.id, `Mistral batch job ${batchStatus.status.toLowerCase()}`);
    } else if (batchStatus.status === "RUNNING" && job.status !== "batch_running") {
      await env.DB.prepare(`UPDATE jobs SET status = 'batch_running', updated_at = datetime('now') WHERE id = ?`)
        .bind(job.id)
        .run();
    }
  } catch (e) {
    console.error(`poll failed for job ${job.id}`, e);
  }
}

export async function pollPendingBatches(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, mistral_batch_job_id, status FROM jobs WHERE status IN ('batch_submitted', 'batch_running') AND mistral_batch_job_id IS NOT NULL",
  ).all<PendingJob>();

  // Independent jobs — poll and finalize them in parallel rather than one
  // Mistral round-trip at a time (matters as pending-job count grows, given
  // Cloudflare scheduled handlers have a wall-clock execution budget).
  await Promise.allSettled(results.map((job) => pollOne(env, job)));
}
