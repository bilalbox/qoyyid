<script lang="ts">
import { isTerminal } from "#lib/api";
import JobStatus from "#lib/components/JobStatus.svelte";
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
</script>

<div class="mx-auto max-w-2xl px-6 py-12">
  <p class="mb-8">
    <a href="/" class="text-sm text-surface-500 hover:text-primary-300">&rarr; العودة إلى الرف</a>
  </p>

  <h1 dir="auto" class="font-heading text-start text-2xl text-surface-50">
    {job.title ?? job.sha256.slice(0, 12)}
  </h1>

  <div class="mt-8">
    <div class="flex items-center justify-between border-b border-surface-800 py-3">
      <span class="text-sm text-surface-500">الحالة</span>
      <JobStatus {job} hint />
    </div>
    <div class="flex items-center justify-between border-b border-surface-800 py-3">
      <span class="text-sm text-surface-500">الوحدات</span>
      <span class="font-mono-data text-sm text-surface-100">
        {job.mistral_units_processed ?? job.source_units}
      </span>
    </div>
    {#if job.error}
      <div class="flex items-center justify-between border-b border-surface-800 py-3">
        <span class="text-sm text-surface-500">الخطأ</span>
        <span class="text-sm text-error-400">{job.error}</span>
      </div>
    {/if}
  </div>

  {#if job.status === "done"}
    <a
      href="/jobs/{job.id}/docx"
      class="btn-seal mt-8 inline-block"
    >
      تحميل .docx
    </a>
  {/if}
</div>
