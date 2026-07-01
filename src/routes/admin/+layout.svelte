<script lang="ts">
  import { page } from "$app/state";
  import type { LayoutProps } from "./$types";

  let { children }: LayoutProps = $props();

  const tabs = [
    { href: "/admin/users", label: "المستخدمون" },
    { href: "/admin/invites", label: "الدعوات" },
    { href: "/admin/jobs", label: "الطلبات" },
  ];
</script>

<div class="mx-auto max-w-5xl px-6 py-10">
  <div class="mb-8 flex items-center justify-between">
    <h1 class="font-heading text-3xl font-bold text-primary-300">الإدارة</h1>
    <nav class="flex gap-1">
      {#each tabs as tab (tab.href)}
        <a
          href={tab.href}
          class="rounded-base px-3 py-1.5 text-sm transition-colors"
          class:bg-surface-800={page.url.pathname === tab.href}
          class:text-primary-300={page.url.pathname === tab.href}
          class:text-surface-400={page.url.pathname !== tab.href}
          class:hover:text-surface-100={page.url.pathname !== tab.href}
        >
          {tab.label}
        </a>
      {/each}
    </nav>
  </div>

  {@render children()}
</div>
