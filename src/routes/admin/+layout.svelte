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

<div class="mx-auto max-w-5xl px-6 py-12">
  <div class="mb-8 flex items-end justify-between">
    <h1 class="font-heading text-xl text-surface-50">الإدارة</h1>
    <nav class="flex gap-6 text-sm">
      {#each tabs as tab (tab.href)}
        <a
          href={tab.href}
          class="border-b pb-1 transition-colors"
          class:border-primary-500={page.url.pathname === tab.href}
          class:text-surface-50={page.url.pathname === tab.href}
          class:border-transparent={page.url.pathname !== tab.href}
          class:text-surface-500={page.url.pathname !== tab.href}
          class:hover:text-surface-100={page.url.pathname !== tab.href}
        >
          {tab.label}
        </a>
      {/each}
    </nav>
  </div>

  {@render children()}
</div>
