import { initializeApp } from "firebase/app";
import { getMessaging, getToken, isSupported } from "firebase/messaging";

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;

/**
 * Requests notification permission and registers this browser's FCM token
 * with the server. No-op if Firebase config is missing (not yet supplied),
 * push isn't supported (e.g. Safari without a home-screen install), or the
 * user declines the permission prompt — job-completion notifications are a
 * nice-to-have, never a blocker for using the app.
 */
export async function enableJobNotifications(): Promise<void> {
	if (!firebaseConfig.apiKey || !vapidKey) return;
	if (!(await isSupported().catch(() => false))) return;
	if (Notification.permission === "denied") return;

	try {
		const permission = await Notification.requestPermission();
		if (permission !== "granted") return;

		const registration = await navigator.serviceWorker.register(
			"/firebase-messaging-sw.js",
		);
		const app = initializeApp(firebaseConfig);
		const messaging = getMessaging(app);
		const token = await getToken(messaging, {
			vapidKey,
			serviceWorkerRegistration: registration,
		});
		if (!token) return;

		await fetch("/me/fcm-token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token }),
		});
	} catch (e) {
		console.error("failed to enable job notifications", e);
	}
}
