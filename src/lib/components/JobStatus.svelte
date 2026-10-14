<script lang="ts">
  import type { Job } from "#lib/api";

  let { job, hint = false }: { job: Job; hint?: boolean } = $props();

  const label = $derived.by(() => {
    if (job.status === "done") return "مكتمل";
    if (job.status === "failed") return "فشل";
    if (job.status === "uploaded") return "مرفوع";
    if (job.status === "batch_submitted" || job.status === "batch_running" || job.status === "mapping") {
      return "قيد المعالجة";
    }
    return job.status;
  });
</script>

{#if job.status === "done"}
  <span class="text-sm text-success-400">{label}</span>
{:else if job.status === "failed"}
  <span class="text-sm text-error-400">{label}</span>
{:else}
  <span class="rubric-mark me-4 text-sm text-primary-300">{label}</span>
  {#if hint}
    <span class="text-xs text-surface-500">لا يوجد وقت محدد — قد يستغرق دقائق أو ساعات</span>
  {/if}
{/if}
