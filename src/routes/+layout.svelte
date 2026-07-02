<script lang="ts">
  import "../app.css";
  import { onMount } from "svelte";
  import { page } from "$app/state";
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

  let onAdminRoute = $derived(page.url.pathname.startsWith("/admin"));
</script>

{#if data.me}
  <header class="rubric-rule sticky top-0 z-20 border-b bg-surface-950/95 backdrop-blur">
    <div class="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
      <a href="/" class="font-heading text-lg tracking-wide text-surface-50">قيد</a>
      <nav class="flex items-center gap-5 text-sm text-surface-400">
        <a
          href="/"
          class="transition-colors hover:text-surface-50"
          class:text-surface-50={!onAdminRoute}
        >
          الرف
        </a>
        {#if data.me.is_admin}
          <a
            href="/admin/users"
            class="transition-colors hover:text-surface-50"
            class:text-surface-50={onAdminRoute}
          >
            الإدارة
          </a>
        {/if}
        <span class="font-mono-data text-xs text-surface-500">
          {data.me.quota_pages_used}/{data.me.quota_pages_limit} وحدة
        </span>
        <button
          onclick={signOut}
          class="cursor-pointer text-surface-500 underline underline-offset-2 transition-colors hover:text-primary-300"
        >
          تسجيل الخروج
        </button>
      </nav>
    </div>
  </header>
{/if}

<main class="min-h-[calc(100vh-64px)] bg-surface-950">
  {@render children()}
</main>
