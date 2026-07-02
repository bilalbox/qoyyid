<script lang="ts">
  import { setUserQuota, type AdminUser } from "$lib/admin-api";
  import { invalidateAll } from "$app/navigation";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let users = $derived(data.users);
  let quotaDrafts = $state<Record<string, string>>({});
  let saving = $state<string | null>(null);
  let saveError = $state<string | null>(null);

  function draftFor(user: AdminUser): string {
    return quotaDrafts[user.id] ?? String(user.quota_pages_limit);
  }

  async function saveQuota(user: AdminUser) {
    const draft = Number(draftFor(user));
    if (!Number.isFinite(draft) || draft < 0) {
      saveError = `${user.email}: أدخل رقماً موجباً`;
      return;
    }
    saving = user.id;
    saveError = null;
    try {
      await setUserQuota(user.id, draft);
      await invalidateAll();
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = null;
    }
  }
</script>

<svelte:head><title>المستخدمون — إدارة قيد</title></svelte:head>

{#if saveError}
  <p class="mb-4 text-sm text-error-400">{saveError}</p>
{/if}

<div class="overflow-x-auto">
  <table class="w-full text-start text-sm">
    <thead class="rubric-rule border-b text-xs text-surface-500">
      <tr>
        <th class="px-4 py-3 font-medium">البريد الإلكتروني</th>
        <th class="px-4 py-3 font-medium">الدور</th>
        <th class="px-4 py-3 font-medium">الاستخدام</th>
        <th class="px-4 py-3 font-medium">الطلبات</th>
        <th class="px-4 py-3 font-medium">تاريخ الانضمام</th>
        <th class="px-4 py-3 font-medium">حصة الصفحات</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-surface-800">
      {#each users as user (user.id)}
        <tr>
          <td class="px-4 py-3 text-surface-100">{user.email}</td>
          <td class="px-4 py-3">
            {#if user.is_admin}
              <span class="text-xs text-primary-300">مسؤول</span>
            {:else}
              <span class="text-surface-600">—</span>
            {/if}
          </td>
          <td class="font-mono-data px-4 py-3 text-surface-300">
            {user.quota_pages_used}/{user.quota_pages_limit} وحدة
          </td>
          <td class="font-mono-data px-4 py-3 text-surface-300">{user.job_count}</td>
          <td class="font-mono-data px-4 py-3 text-surface-500">{user.created_at}</td>
          <td class="px-4 py-3">
            <form class="flex items-center gap-2" onsubmit={(e) => (e.preventDefault(), saveQuota(user))}>
              <input
                type="number"
                min="0"
                value={draftFor(user)}
                oninput={(e) => (quotaDrafts[user.id] = e.currentTarget.value)}
                class="input font-mono-data w-24 border-surface-700 bg-transparent px-2 py-1 text-sm"
              />
              <button
                type="submit"
                class="text-sm text-surface-400 underline underline-offset-2 hover:text-primary-300 disabled:opacity-50"
                disabled={saving === user.id}
              >
                {saving === user.id ? "جاري الحفظ…" : "حفظ"}
              </button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
