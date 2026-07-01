<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import type { LayoutProps } from "./$types";
  import { enableJobNotifications } from "$lib/notifications";

  let { children, data }: LayoutProps = $props();

  onMount(() => {
    if (data.me) enableJobNotifications();
  });

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
</script>

{#if data.me}
  <header class="jadwal-rule bg-surface-50">
    <div class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
      <a href="/" class="font-heading text-xl font-bold tracking-wide text-surface-950">qoyyid</a>
      <nav class="flex items-center gap-4 text-sm text-tertiary-700">
        <a href="/" class="hover:text-primary-600">jobs</a>
        {#if data.me.is_admin}
          <a href="/admin/users" class="hover:text-primary-600">admin</a>
        {/if}
        <span class="badge preset-tonal-secondary font-mono-data text-xs">
          {data.me.quota_pages_used}/{data.me.quota_pages_limit} pages
        </span>
        <button
          onclick={signOut}
          class="cursor-pointer text-tertiary-700 underline underline-offset-2 hover:text-primary-600"
        >
          sign out
        </button>
      </nav>
    </div>
  </header>
{/if}

<main class="mx-auto max-w-3xl px-6 py-10">
  {@render children()}
</main>
