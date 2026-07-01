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

<p class="mb-6">
  <a href="/" class="text-sm text-tertiary-700 hover:text-primary-600">&larr; back to shelf</a>
</p>

<h1 dir="auto" class="h2 font-heading text-left">{job.title ?? job.sha256.slice(0, 12)}</h1>

<div class="card preset-filled-surface-100-900 mt-6 divide-y divide-surface-300 dark:divide-surface-700">
  <div class="flex items-center justify-between p-4">
    <span class="text-sm text-tertiary-600">Status</span>
    <div class="flex items-center gap-2">
      {#if job.status === "done"}
        <span class="badge preset-tonal-success text-xs">done</span>
      {:else if job.status === "failed"}
        <span class="badge preset-tonal-error text-xs">failed</span>
      {:else}
        <span class="badge-dot preset-filled-primary-500 text-xs">{statusLabel()}</span>
        <span class="text-xs text-tertiary-500">no fixed SLA — may take minutes to hours</span>
      {/if}
    </div>
  </div>
  <div class="flex items-center justify-between p-4">
    <span class="text-sm text-tertiary-600">Pages</span>
    <span class="font-mono-data text-sm">{job.mistral_pages_processed ?? job.total_pages}</span>
  </div>
  {#if job.error}
    <div class="flex items-center justify-between p-4">
      <span class="text-sm text-tertiary-600">Error</span>
      <span class="text-sm text-error-600">{job.error}</span>
    </div>
  {/if}
</div>

{#if job.status === "done"}
  <a href="/jobs/{job.id}/docx" class="btn preset-filled-secondary-500 mt-6"> Download .docx </a>
{/if}
