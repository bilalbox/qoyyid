<script lang="ts">
  import { reproduceDocument, reproduceDocx, type AdminJob } from "$lib/admin-api";
  import { invalidateAll } from "$app/navigation";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let jobs = $derived(data.jobs);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function run(action: "document" | "docx", job: AdminJob) {
    busy = `${job.id}:${action}`;
    error = null;
    try {
      if (action === "document") await reproduceDocument(job.id);
      else await reproduceDocx(job.id);
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head><title>الطلبات — إدارة قيد</title></svelte:head>

{#if error}
  <p class="mb-4 text-sm text-error-400">{error}</p>
{/if}

<div class="overflow-x-auto">
  <table class="w-full text-start text-sm">
    <thead class="rubric-rule border-b text-xs text-surface-500">
      <tr>
        <th class="px-4 py-3 font-medium">العنوان</th>
        <th class="px-4 py-3 font-medium">المستخدم</th>
        <th class="px-4 py-3 font-medium">الحالة</th>
        <th class="px-4 py-3 font-medium">تاريخ الإنشاء</th>
        <th class="px-4 py-3 font-medium">التنزيلات</th>
        <th class="px-4 py-3 font-medium">الإجراءات</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-surface-800">
      {#each jobs as job (job.id)}
        <tr>
          <td class="max-w-48 truncate px-4 py-3 text-surface-100" title={job.title ?? job.id}>
            {job.title ?? job.id.slice(0, 8)}
          </td>
          <td class="px-4 py-3 text-surface-300">{job.user_email}</td>
          <td class="px-4 py-3">
            {#if job.status === "done"}
              <span class="text-xs text-success-400">مكتمل</span>
            {:else if job.status === "failed"}
              <span class="text-xs text-error-400" title={job.error ?? ""}>فشل</span>
            {:else}
              <span class="rubric-mark me-4 text-xs text-primary-300">{job.status}</span>
            {/if}
          </td>
          <td class="font-mono-data px-4 py-3 text-surface-500">{job.created_at}</td>
          <td class="px-4 py-3 whitespace-nowrap">
            <span class="flex gap-3 text-xs">
              {#if job.available.pdf}
                <a href="/admin/jobs/{job.id}/pdf" class="text-primary-300 hover:underline">pdf</a>
              {:else}
                <span class="text-surface-600">pdf</span>
              {/if}
              {#if job.available.response}
                <a href="/admin/jobs/{job.id}/mistral-response" class="text-primary-300 hover:underline">
                  response
                </a>
              {:else}
                <span class="text-surface-600">response</span>
              {/if}
              {#if job.available.document}
                <a href="/admin/jobs/{job.id}/document" class="text-primary-300 hover:underline">
                  document
                </a>
              {:else}
                <span class="text-surface-600">document</span>
              {/if}
              {#if job.available.docx}
                <a href="/admin/jobs/{job.id}/docx" class="text-primary-300 hover:underline">docx</a>
              {:else}
                <span class="text-surface-600">docx</span>
              {/if}
            </span>
          </td>
          <td class="px-4 py-3 whitespace-nowrap">
            <div class="flex gap-4 text-sm">
              <button
                type="button"
                class="text-surface-400 underline underline-offset-2 hover:text-primary-300 disabled:opacity-50"
                disabled={!job.available.response || busy === `${job.id}:document`}
                title={job.available.response ? "" : "لا توجد استجابة Mistral محفوظة لهذا الطلب"}
                onclick={() => run("document", job)}
              >
                {busy === `${job.id}:document` ? "جاري العمل…" : "إعادة إنشاء المستند"}
              </button>
              <button
                type="button"
                class="text-surface-400 underline underline-offset-2 hover:text-primary-300 disabled:opacity-50"
                disabled={!job.available.document || busy === `${job.id}:docx`}
                title={job.available.document ? "" : "لا يوجد document.json محفوظ لهذا الطلب"}
                onclick={() => run("docx", job)}
              >
                {busy === `${job.id}:docx` ? "جاري العمل…" : "إعادة إنشاء docx"}
              </button>
            </div>
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="6" class="px-4 py-6 text-center text-surface-500">لا توجد طلبات حتى الآن.</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
