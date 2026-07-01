<script lang="ts">
  import { createInvite, listInvites, type AdminInvite } from "$lib/admin-api";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();

  let invites = $state<AdminInvite[]>(data.invites);
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
      invites = await listInvites();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head><title>Invites — qoyyid admin</title></svelte:head>

<form onsubmit={onCreate} class="mb-6 flex gap-2">
  <input
    type="email"
    bind:value={email}
    placeholder="email@example.com"
    required
    class="input bg-surface-900 px-3 py-2 text-sm"
  />
  <button type="submit" class="btn preset-filled-primary-500" disabled={creating}>
    {creating ? "Creating…" : "Create invite"}
  </button>
</form>
{#if error}
  <p class="mb-4 text-sm text-error-400">{error}</p>
{/if}

<div class="card jadwal-rule overflow-x-auto bg-surface-900">
  <table class="w-full text-left text-sm">
    <thead class="jadwal-rule text-xs text-surface-400">
      <tr>
        <th class="px-4 py-3 font-medium">Email</th>
        <th class="px-4 py-3 font-medium">Created</th>
        <th class="px-4 py-3 font-medium">Status</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-surface-800">
      {#each invites as invite (invite.email)}
        <tr>
          <td class="px-4 py-3 text-surface-100">{invite.email}</td>
          <td class="font-mono-data px-4 py-3 text-surface-400">{invite.created_at}</td>
          <td class="px-4 py-3">
            {#if invite.used_at}
              <span class="badge preset-tonal-success text-xs">used</span>
            {:else}
              <span class="badge preset-tonal-primary text-xs">pending</span>
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="3" class="px-4 py-6 text-center text-surface-500">No invites yet.</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
