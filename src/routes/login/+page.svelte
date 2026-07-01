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
        verifyError = "فشل التحقق. يرجى المحاولة مرة أخرى.";
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

<div class="flex min-h-screen items-center justify-center bg-surface-950 px-6">
  <div class="card jadwal-rule w-full max-w-sm bg-surface-900 p-8 text-center shadow-xl shadow-black/40">
    <p class="font-heading text-3xl font-bold tracking-wide text-primary-300">قيد</p>
      حول المخطوطات إلى نصوص منظمة وقابلة للتحرير.

    {#if error === "invite_required"}
      <p class="mt-6 text-sm text-error-400">
        مطلوب دعوة لإنشاء حساب. اطلب من مسؤول إضافة بريدك الإلكتروني.
      </p>
    {/if}
    {#if error === "turnstile_required"}
      <p class="mt-6 text-sm text-error-400">يرجى إكمال التحدي قبل تسجيل الدخول.</p>
    {/if}
    {#if verifyError}
      <p class="mt-6 text-sm text-error-400">{verifyError}</p>
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
      تسجيل الدخول عبر جوجل
    </button>
  </div>
</div>
