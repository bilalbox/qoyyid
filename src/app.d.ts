/// <reference types="vite/client" />

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface ImportMetaEnv {
		readonly VITE_TURNSTILE_SITE_KEY?: string;
		readonly VITE_FIREBASE_API_KEY?: string;
		readonly VITE_FIREBASE_PROJECT_ID?: string;
		readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
		readonly VITE_FIREBASE_APP_ID?: string;
		readonly VITE_FIREBASE_VAPID_KEY?: string;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
