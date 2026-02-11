/* firebase-messaging-sw.js */
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAq9RTNQDnfyxcxn4MbDn61lc7ybkUjtKg",
  authDomain: "memorycarl-3c297.firebaseapp.com",
  projectId: "memorycarl-3c297",
  storageBucket: "memorycarl-3c297.firebasestorage.app",
  messagingSenderId: "731735548765",
  appId: "1:731735548765:web:03d9cf6d2a8c4744fd7eb4"
});

const messaging = firebase.messaging();

// Esto permite mostrar notificaciones cuando llega un push y la app no está abierta
messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || "MemoryCarl";
  const options = {
    body: payload?.notification?.body || "Reminder",
    icon: "./public/icons/icon-192.png"
  };
  self.registration.showNotification(title, options);
});
