// Background FCM handler. Static assets aren't processed by vite's env
// substitution, so this config is duplicated from the VITE_FIREBASE_* values
// in .env — the Firebase web config is public by design (safe to ship in a
// service worker), see https://firebase.google.com/docs/projects/api-keys.
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDDlnwB9NvQsQ6tcUIFLGJYTNY977spw44",
  projectId: "qoyyid",
  messagingSenderId: "745538286889",
  appId: "1:745538286889:web:d9517a55e6991fbf027338",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification ?? {};
  self.registration.showNotification(title ?? "qoyyid", {
    body: body ?? "",
    icon: "/favicon-32x32.png",
    data: payload.data,
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const jobId = event.notification.data?.jobId;
  event.waitUntil(clients.openWindow(jobId ? `/jobs/${jobId}` : "/"));
});
