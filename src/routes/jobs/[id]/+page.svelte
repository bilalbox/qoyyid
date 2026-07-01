<script lang="ts">
  import { isTerminal } from "$lib/api";
  import { invalidateAll } from "$app/navigation";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  let job = $derived(data.job);

  $effect(() => {
    if (isTerminal(job.status)) return;
    const interval = setInterval(() => {
      invalidateAll();
    }, 5000);
    return () => clearInterval(interval);
  });

  function statusLabel(): string {
    if (job.status === "batch_submitted" || job.status === "batch_running") {
      return "قيد المعالجة";
    }
    if (job.status === "uploaded") return "مرفوع";
    if (job.status === "mapping") return "قيد المعالجة";
    return job.status;
  }
</script>

<div class="mx-auto max-w-3xl px-6 py-10">
  <p class="mb-6">
    <a href="/" class="text-sm text-surface-400 hover:text-primary-300">&rarr; العودة إلى الرف</a>
  </p>

  <h1 dir="auto" class="font-heading text-start text-3xl font-bold text-primary-300">
    {job.title ?? job.sha256.slice(0, 12)}
  </h1>

  <div class="card jadwal-rule mt-6 divide-y divide-surface-800 bg-surface-900">
    <div class="flex items-center justify-between p-4">
      <span class="text-sm text-surface-400">الحالة</span>
      <div class="flex items-center gap-2">
        {#if job.status === "done"}
          <span class="badge preset-tonal-success text-xs">مكتمل</span>
        {:else if job.status === "failed"}
          <span class="badge preset-tonal-error text-xs">فشل</span>
        {:else}
          <span class="badge-dot preset-tonal-primary text-xs">{statusLabel()}</span>
          <span class="text-xs text-surface-500">لا يوجد وقت محدد — قد يستغرق دقائق أو ساعات</span>
        {/if}
      </div>
    </div>
    <div class="flex items-center justify-between p-4">
      <span class="text-sm text-surface-400">الوحدات</span>
      <span class="font-mono-data text-sm text-surface-100">
        {job.mistral_units_processed ?? job.source_units}
      </span>
    </div>
    {#if job.error}
      <div class="flex items-center justify-between p-4">
        <span class="text-sm text-surface-400">الخطأ</span>
        <span class="text-sm text-error-400">{job.error}</span>
      </div>
    {/if}
  </div>

  {#if job.status === "done"}
    <a href="/jobs/{job.id}/docx" class="btn preset-filled-primary-500 mt-6"> تحميل .docx </a>
  {/if}
</div>
