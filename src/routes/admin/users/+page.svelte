<script lang="ts">
  import { setUserQuota, type AdminUser } from "$lib/admin-api";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let users = $state<AdminUser[]>(data.users);
  let quotaDrafts = $state<Record<string, string>>(
    Object.fromEntries(data.users.map((u) => [u.id, String(u.quota_pages_limit)])),
  );
  let saving = $state<string | null>(null);
  let saveError = $state<string | null>(null);

  async function saveQuota(user: AdminUser) {
    const draft = Number(quotaDrafts[user.id]);
    if (!Number.isFinite(draft) || draft < 0) {
      saveError = `${user.email}: enter a non-negative number`;
      return;
    }
    saving = user.id;
    saveError = null;
    try {
      await setUserQuota(user.id, draft);
      users = users.map((u) => (u.id === user.id ? { ...u, quota_pages_limit: draft } : u));
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = null;
    }
  }
</script>

<svelte:head><title>Users — qoyyid admin</title></svelte:head>

{#if saveError}
  <p class="mb-4 text-sm text-error-400">{saveError}</p>
{/if}

<div class="card jadwal-rule overflow-x-auto bg-surface-900">
  <table class="w-full text-left text-sm">
    <thead class="jadwal-rule text-xs text-surface-400">
      <tr>
        <th class="px-4 py-3 font-medium">Email</th>
        <th class="px-4 py-3 font-medium">Role</th>
        <th class="px-4 py-3 font-medium">Usage</th>
        <th class="px-4 py-3 font-medium">Jobs</th>
        <th class="px-4 py-3 font-medium">Joined</th>
        <th class="px-4 py-3 font-medium">Page quota</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-surface-800">
      {#each users as user (user.id)}
        <tr>
          <td class="px-4 py-3 text-surface-100">{user.email}</td>
          <td class="px-4 py-3">
            {#if user.is_admin}
              <span class="badge preset-tonal-primary text-xs">admin</span>
            {:else}
              <span class="text-surface-500">—</span>
            {/if}
          </td>
          <td class="font-mono-data px-4 py-3 text-surface-300">
            {user.quota_pages_used}/{user.quota_pages_limit} pages
          </td>
          <td class="font-mono-data px-4 py-3 text-surface-300">{user.job_count}</td>
          <td class="font-mono-data px-4 py-3 text-surface-400">{user.created_at}</td>
          <td class="px-4 py-3">
            <form class="flex items-center gap-2" onsubmit={(e) => (e.preventDefault(), saveQuota(user))}>
              <input
                type="number"
                min="0"
                bind:value={quotaDrafts[user.id]}
                class="input font-mono-data w-24 bg-surface-950 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                class="btn preset-tonal-primary btn-sm"
                disabled={saving === user.id}
              >
                {saving === user.id ? "Saving…" : "Save"}
              </button>
            </form>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
