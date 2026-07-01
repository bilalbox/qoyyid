<script lang="ts">
  import { getJob, isTerminal, type Job } from "$lib/api";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  let job = $state<Job>(data.job);

  $effect(() => {
    if (isTerminal(job.status)) return;
    const interval = setInterval(async () => {
      try {
        job = await getJob(job.id);
      } catch {
        // transient poll failure; retry on next tick
      }
    }, 5000);
    return () => clearInterval(interval);
  });

  function statusLabel(): string {
    if (job.status === "batch_submitted" || job.status === "batch_running") {
      return "processing";
    }
    return job.status;
  }
</script>

<div class="mx-auto max-w-3xl px-6 py-10">
  <p class="mb-6">
    <a href="/" class="text-sm text-surface-400 hover:text-primary-300">&larr; back to shelf</a>
  </p>

  <h1 dir="auto" class="font-heading text-left text-3xl font-bold text-primary-300">
    {job.title ?? job.sha256.slice(0, 12)}
  </h1>

  <div class="card jadwal-rule mt-6 divide-y divide-surface-800 bg-surface-900">
    <div class="flex items-center justify-between p-4">
      <span class="text-sm text-surface-400">Status</span>
      <div class="flex items-center gap-2">
        {#if job.status === "done"}
          <span class="badge preset-tonal-success text-xs">done</span>
        {:else if job.status === "failed"}
          <span class="badge preset-tonal-error text-xs">failed</span>
        {:else}
          <span class="badge-dot preset-tonal-primary text-xs">{statusLabel()}</span>
          <span class="text-xs text-surface-500">no fixed SLA — may take minutes to hours</span>
        {/if}
      </div>
    </div>
    <div class="flex items-center justify-between p-4">
      <span class="text-sm text-surface-400">Units</span>
      <span class="font-mono-data text-sm text-surface-100">
        {job.mistral_units_processed ?? job.source_units}
      </span>
    </div>
    {#if job.error}
      <div class="flex items-center justify-between p-4">
        <span class="text-sm text-surface-400">Error</span>
        <span class="text-sm text-error-400">{job.error}</span>
      </div>
    {/if}
  </div>

  {#if job.status === "done"}
    <a href="/jobs/{job.id}/docx" class="btn preset-filled-primary-500 mt-6"> Download .docx </a>
  {/if}
</div>
