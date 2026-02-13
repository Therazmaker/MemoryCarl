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

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var notification = (payload && payload.notification) ? payload.notification : {};
  var title = notification.title || "MemoryCarl";
  var options = {
    body: notification.body || "Reminder",
    // IMPORTANTE: en GitHub Pages usualmente NO existe /public/
    icon: "./icons/icon-192.png"
  };

  self.registration.showNotification(title, options);
});
