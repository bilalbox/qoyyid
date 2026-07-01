<script lang="ts">
  import { getJob, isTerminal, uploadJob, type Job } from "$lib/api";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let jobs = $state<Job[]>(data.jobs);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let fileName = $state<string | null>(null);

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
      fileName = null;
    } catch (err) {
      uploadError = err instanceof Error ? err.message : String(err);
    } finally {
      uploading = false;
    }
  }

  function onFileChange() {
    fileName = fileInput?.files?.[0]?.name ?? null;
  }

  const relTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function updatedAgo(iso: string): string {
    const diffMs = new Date(iso).getTime() - Date.now();
    const mins = Math.round(diffMs / 60000);
    if (Math.abs(mins) < 60) return relTime.format(mins, "minute");
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return relTime.format(hours, "hour");
    return relTime.format(Math.round(hours / 24), "day");
  }

  function statusLabel(job: Job): string {
    if (job.status === "batch_submitted" || job.status === "batch_running") {
      return "processing";
    }
    return job.status;
  }
</script>

<div class="mx-auto max-w-3xl space-y-10 px-6 py-10">
  <section>
    <h2 class="font-heading text-xl font-bold text-primary-300">Upload a manuscript or audio</h2>
    <form onsubmit={onUpload} class="mt-3">
      <label
        class="flex cursor-pointer flex-col items-center gap-1 rounded-container border-2 border-dashed border-surface-700 bg-surface-900/60 px-6 py-10 text-center transition-colors hover:border-primary-500 hover:bg-surface-900"
      >
        <span class="font-medium text-surface-100">
          {fileName ?? "Drop a PDF or Audio file here, or click to browse"}
        </span>
        <span class="text-sm text-surface-400">
          Scanned PDF pages or Audio files (mp3, wav, m4a, flac).
        </span>
        <input
          type="file"
          accept="application/pdf,audio/mpeg,audio/wav,audio/x-m4a,audio/mp4,audio/flac"
          class="sr-only"
          bind:this={fileInput}
          onchange={onFileChange}
          required
        />
      </label>
      <button type="submit" class="btn preset-filled-primary-500 mt-4" disabled={uploading}>
        {uploading ? "Uploading…" : "Upload"}
      </button>
    </form>
    {#if uploadError}
      <p class="mt-2 text-sm text-error-400">{uploadError}</p>
    {/if}
  </section>

  <section>
    <div class="jadwal-rule mb-3 flex items-center justify-between pb-3">
      <h2 class="font-heading text-xl font-bold text-primary-300">Your shelf</h2>
      <span class="font-mono-data text-xs text-surface-400">
        {jobs.length}
        {jobs.length === 1 ? "manuscript" : "manuscripts"}
      </span>
    </div>

    {#if jobs.length === 0}
      <div class="card bg-surface-900 p-6 text-center text-surface-400">
        Your shelf is empty — upload a manuscript above to begin.
      </div>
    {:else}
      <ul class="space-y-3">
        {#each jobs as job (job.id)}
          <li
            class="card relative border border-surface-800 bg-surface-900 p-4 transition-colors hover:bg-surface-800"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <a href="/jobs/{job.id}" class="static after:absolute after:inset-0">
                  <p dir="auto" class="font-heading truncate text-left text-lg font-bold text-surface-50">
                    {job.title ?? job.sha256.slice(0, 12)}
                  </p>
                </a>
                <p class="font-mono-data mt-1 text-sm text-surface-400">
                  {job.mistral_units_processed ?? job.source_units} units · updated {updatedAgo(
                    job.updated_at,
                  )}
                </p>
              </div>
              <div class="relative z-10 flex shrink-0 items-center gap-2">
                {#if job.status === "done"}
                  <span class="badge preset-tonal-success text-xs">done</span>
                  <a
                    href="/jobs/{job.id}/docx"
                    class="btn-icon preset-tonal-primary"
                    title="Download .docx"
                    aria-label="Download .docx"
                  >
                    ↓
                  </a>
                {:else if job.status === "failed"}
                  <span class="badge preset-tonal-error text-xs">failed</span>
                {:else}
                  <span class="badge-dot preset-tonal-primary text-xs">
                    {statusLabel(job)}
                  </span>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
