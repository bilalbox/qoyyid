<script lang="ts">
  import { getJob, isTerminal, uploadJob, type Job } from "$lib/api";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let jobs = $state<Job[]>(data.jobs);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    const pending = jobs.filter((j) => !isTerminal(j.status));
    if (pending.length === 0) return;

    const interval = setInterval(async () => {
      for (const job of pending) {
        try {
          const updated = await getJob(job.id);
          jobs = jobs.map((j) => (j.id === updated.id ? updated : j));
        } catch {
          // transient poll failure; retry on next tick
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  });

  async function onUpload(e: SubmitEvent) {
    e.preventDefault();
    const file = fileInput?.files?.[0];
    if (!file) return;
    uploading = true;
    uploadError = null;
    try {
      const { job_id } = await uploadJob(file);
      const job = await getJob(job_id);
      jobs = [job, ...jobs.filter((j) => j.id !== job.id)];
      if (fileInput) fileInput.value = "";
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
    } finally {
      uploading = false;
    }
  }

  function statusLabel(job: Job): string {
    if (job.status === "batch_submitted" || job.status === "batch_running") {
      return "processing (may take up to a day)";
    }
    return job.status;
  }
</script>

<h1>qoyyid</h1>

<form onsubmit={onUpload}>
  <input type="file" accept="application/pdf" bind:this={fileInput} required />
  <button type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload PDF"}</button>
</form>
{#if uploadError}
  <p class="error">{uploadError}</p>
{/if}

<table>
  <thead>
    <tr><th>Title</th><th>Status</th><th>Pages</th><th></th></tr>
  </thead>
  <tbody>
    {#each jobs as job (job.id)}
      <tr>
        <td>{job.title ?? job.sha256.slice(0, 12)}</td>
        <td>{statusLabel(job)}</td>
        <td>{job.mistral_pages_processed ?? job.total_pages}</td>
        <td>
          <a href="/jobs/{job.id}">details</a>
          {#if job.status === "done"}
            · <a href="/jobs/{job.id}/docx">download</a>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .error {
    color: #b00020;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin-top: 1rem;
  }
  td,
  th {
    border: 1px solid #ccc;
    padding: 0.4rem 0.6rem;
    text-align: left;
  }
</style>
