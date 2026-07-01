<script lang="ts">
  import { page } from "$app/state";

  let error = $derived(page.url.searchParams.get("error"));
</script>

<h1>qoyyid</h1>

{#if error === "invite_required"}
  <p class="error">An invite is required to create an account. Ask an admin to add your email.</p>
{/if}

<!-- /auth/google is a stateful redirect that mints a one-time OAuth state/verifier
     pair and overwrites cookies on every hit — SvelteKit's default hover-preload
     (see app.html) would silently re-trigger it before the real click, invalidating
     the code Google returns. Must stay off for this link. -->
<a class="google-btn" href="/auth/google" data-sveltekit-preload-data="off">Sign in with Google</a>

<style>
  .error {
    color: #b00020;
  }
  .google-btn {
    display: inline-block;
    padding: 0.6rem 1.2rem;
    border: 1px solid #ccc;
    border-radius: 4px;
    text-decoration: none;
    color: inherit;
  }
</style>
