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
</script>

<p><a href="/">&larr; back</a></p>
<h1>{job.title ?? job.sha256.slice(0, 12)}</h1>

<dl>
  <dt>Status</dt>
  <dd>
    {job.status}
    {#if job.status === "batch_submitted" || job.status === "batch_running"}
      <span class="hint">(no fixed SLA — may take minutes to hours)</span>
    {/if}
  </dd>
  <dt>Pages</dt>
  <dd>{job.mistral_pages_processed ?? job.total_pages}</dd>
  {#if job.error}
    <dt>Error</dt>
    <dd class="error">{job.error}</dd>
  {/if}
</dl>

{#if job.status === "done"}
  <a href="/jobs/{job.id}/docx">Download .docx</a>
{/if}

<style>
  .error {
    color: #b00020;
  }
  .hint {
    color: #666;
  }
</style>
