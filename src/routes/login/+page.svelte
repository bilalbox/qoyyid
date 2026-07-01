<script lang="ts">
  import { page } from "$app/state";

  let error = $derived(page.url.searchParams.get("error"));
  let turnstileToken = $state<string | null>(null);
  let verifying = $state(false);
  let verifyError = $state<string | null>(null);

  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

  // Exposed for the Turnstile widget's data-callback/data-error-callback.
  if (typeof window !== "undefined") {
    (window as any).onTurnstileSuccess = (token: string) => {
      turnstileToken = token;
    };
    (window as any).onTurnstileExpired = () => {
      turnstileToken = null;
    };
  }

  async function signIn() {
    if (!turnstileToken) return;
    verifying = true;
    verifyError = null;
    try {
      const res = await fetch("/auth/turnstile/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: turnstileToken }),
      });
      if (!res.ok) {
        verifyError = "Verification failed. Please try the challenge again.";
        turnstileToken = null;
        return;
      }
      // /auth/google is a stateful redirect that mints a one-time OAuth state/verifier
      // pair and overwrites cookies on every hit, so it's triggered via direct
      // navigation only after the turnstile cookie is set — never preloaded.
      window.location.href = "/auth/google";
    } finally {
      verifying = false;
    }
  }
</script>

<svelte:head>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
</svelte:head>

<div class="flex min-h-[80vh] items-center justify-center">
  <div class="card preset-filled-surface-100-900 jadwal-rule w-full max-w-sm p-8 text-center">
    <p class="font-heading text-2xl font-bold tracking-wide">qoyyid</p>
    <p class="mt-2 text-sm text-tertiary-600">
      Turn scanned manuscripts into structured, editable text.
    </p>

    {#if error === "invite_required"}
      <p class="mt-6 text-sm text-error-600">
        An invite is required to create an account. Ask an admin to add your email.
      </p>
    {/if}
    {#if error === "turnstile_required"}
      <p class="mt-6 text-sm text-error-600">Please complete the challenge before signing in.</p>
    {/if}
    {#if verifyError}
      <p class="mt-6 text-sm text-error-600">{verifyError}</p>
    {/if}

    {#if siteKey}
      <div class="mt-8 flex justify-center">
        <div
          class="cf-turnstile"
          data-sitekey={siteKey}
          data-callback="onTurnstileSuccess"
          data-expired-callback="onTurnstileExpired"
          data-error-callback="onTurnstileExpired"
        ></div>
      </div>
    {/if}

    <button
      onclick={signIn}
      disabled={!turnstileToken || verifying}
      class="btn preset-filled-primary-500 mt-6 w-full disabled:cursor-not-allowed disabled:opacity-50"
    >
      Sign in with Google
    </button>
  </div>
</div>
