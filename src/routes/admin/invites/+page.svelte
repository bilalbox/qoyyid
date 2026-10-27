<script lang="ts">
import { type AdminInvite, createInvite } from "#lib/admin-api";
import { invalidateAll } from "$app/navigation";
import type { PageProps } from "./$types";

let { data }: PageProps = $props();

let invites = $derived(data.invites);
let email = $state("");
let creating = $state(false);
let error = $state<string | null>(null);

async function onCreate(e: SubmitEvent) {
	e.preventDefault();
	if (!email.trim()) return;
	creating = true;
	error = null;
	try {
		await createInvite(email.trim());
		email = "";
		await invalidateAll();
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		creating = false;
	}
}
</script>

<svelte:head><title>الدعوات — إدارة قيد</title></svelte:head>

<form onsubmit={onCreate} class="mb-8 flex gap-2">
  <input
    type="email"
    bind:value={email}
    placeholder="email@example.com"
    required
    class="input border-surface-700 bg-transparent px-3 py-2 text-sm"
  />
  <button
    type="submit"
    class="btn-seal"
    disabled={creating}
  >
    {creating ? "جاري الإنشاء…" : "إنشاء دعوة"}
  </button>
</form>
{#if error}
  <p class="mb-4 text-sm text-error-400">{error}</p>
{/if}

<div class="overflow-x-auto">
  <table class="w-full text-start text-sm">
    <thead class="rubric-rule border-b text-xs text-surface-500">
      <tr>
        <th class="px-4 py-3 font-medium">البريد الإلكتروني</th>
        <th class="px-4 py-3 font-medium">تاريخ الإنشاء</th>
        <th class="px-4 py-3 font-medium">الحالة</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-surface-800">
      {#each invites as invite (invite.email)}
        <tr>
          <td class="px-4 py-3 text-surface-100">{invite.email}</td>
          <td class="font-mono-data px-4 py-3 text-surface-500">{invite.created_at}</td>
          <td class="px-4 py-3">
            {#if invite.used_at}
              <span class="text-xs text-success-400">مستخدمة</span>
            {:else}
              <span class="text-xs text-surface-400">قيد الانتظار</span>
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="3" class="px-4 py-6 text-center text-surface-500">لا توجد دعوات حتى الآن.</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
