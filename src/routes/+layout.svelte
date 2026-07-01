<script lang="ts">
  import type { LayoutProps } from "./$types";

  let { children, data }: LayoutProps = $props();

  async function signOut() {
    await fetch("/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }
</script>

{#if data.me}
  <nav>
    <a href="/">jobs</a>
    {#if data.me.is_admin}
      · <a href="/admin/users">admin</a>
    {/if}
    · <span class="quota">{data.me.quota_pages_used}/{data.me.quota_pages_limit} pages</span>
    · <button onclick={signOut}>sign out</button>
  </nav>
{/if}

<main>
  {@render children()}
</main>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    max-width: 720px;
    margin: 2rem auto;
    padding: 0 1rem;
  }
  nav {
    margin-bottom: 1.5rem;
    color: #666;
  }
  .quota {
    color: #666;
  }
  button {
    background: none;
    border: none;
    color: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
    font: inherit;
  }
</style>
