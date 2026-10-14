<script lang="ts">
  import { isTerminal, uploadJob } from "#lib/api";
  import { invalidateAll } from "$app/navigation";
  import JobStatus from "#lib/components/JobStatus.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let jobs = $derived(data.jobs);
  let uploading = $state(false);
  let uploadError = $state<string | null>(null);
  let fileInput: HTMLInputElement | undefined = $state();
  let fileName = $state<string | null>(null);

  $effect(() => {
    const pending = jobs.filter((j) => !isTerminal(j.status));
    if (pending.length === 0) return;

    const interval = setInterval(() => {
      invalidateAll();
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
      await uploadJob(file);
      await invalidateAll();
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

  const relTime = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });
  function updatedAgo(iso: string): string {
    const diffMs = new Date(iso).getTime() - Date.now();
    const mins = Math.round(diffMs / 60000);
    if (Math.abs(mins) < 60) return relTime.format(mins, "minute");
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return relTime.format(hours, "hour");
    return relTime.format(Math.round(hours / 24), "day");
  }
</script>

<div class="mx-auto max-w-2xl space-y-12 px-6 py-12">
  <section>
    <h2 class="font-heading text-lg text-surface-200">رفع مخطوطة أو ملف صوتي</h2>
    <form onsubmit={onUpload} class="mt-4">
      <label
        class="flex cursor-pointer flex-col items-center gap-1 rounded-container border border-dashed border-surface-700 px-6 py-12 text-center transition-colors hover:border-primary-500"
      >
        <span class="text-surface-200">
          {fileName ?? "أسقط ملف PDF أو ملف صوتي هنا، أو انقر للتصفح"}
        </span>
        <span class="text-sm text-surface-500">
          صفحات PDF الممسوحة ضوئياً أو ملفات صوتية (mp3, wav, m4a, flac).
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
      <div class="mt-4 flex justify-center">
        <button
          type="submit"
          class="btn-seal"
          disabled={uploading}
        >
          {uploading ? "جاري الرفع…" : "رفع"}
        </button>
      </div>
    </form>
    {#if uploadError}
      <p class="mt-2 text-sm text-error-400">{uploadError}</p>
    {/if}
  </section>

  <section>
    <div class="rubric-rule mb-1 flex items-end justify-between border-b pb-3">
      <h2 class="font-heading text-lg text-surface-200">الرف الخاص بك</h2>
      <span class="font-mono-data text-xs text-surface-500">
        {jobs.length}
        {jobs.length === 1 ? "مخطوطة" : "مخطوطات"}
      </span>
    </div>

    {#if jobs.length === 0}
      <p class="py-8 text-center text-sm text-surface-500">
        الرف فارغ — ابدأ برفع مخطوطة في الأعلى.
      </p>
    {:else}
      <ul>
        {#each jobs as job (job.id)}
          <li class="group relative flex items-center justify-between gap-4 border-b border-surface-800 py-4">
            <div class="min-w-0">
              <a href="/jobs/{job.id}" class="static after:absolute after:inset-0">
                <p dir="auto" class="font-heading truncate text-start text-base text-surface-50">
                  {job.title ?? job.sha256.slice(0, 12)}
                </p>
              </a>
              <p class="font-mono-data mt-1 text-xs text-surface-500">
                {job.mistral_units_processed ?? job.source_units} وحدة · حُدث {updatedAgo(job.updated_at)}
              </p>
            </div>
            <div class="relative z-10 flex shrink-0 items-center gap-4">
              <JobStatus {job} />
              {#if job.status === "done"}
                <a
                  href="/jobs/{job.id}/docx"
                  class="text-sm text-surface-400 underline underline-offset-2 transition-colors hover:text-primary-300"
                  title="تحميل .docx"
                >
                  تحميل
                </a>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
