const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

exports.sendHireHubPush = onDocumentCreated(
  { document: "notifications/{notificationId}", region: "asia-south1" },
  async (event) => {
    const notification = event.data?.data();
    if (!notification?.recipientId) return;
    const db = getFirestore();
    const userRef = db.collection("users").doc(String(notification.recipientId));
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;
    const user = userSnap.data() || {};
    const tokens = [...new Set([
      ...(Array.isArray(user.fcmTokens) ? user.fcmTokens : []),
      ...(typeof user.fcmToken === "string" ? [user.fcmToken] : [])
    ].filter((token) => typeof token === "string" && token.length > 20))];
    if (!tokens.length) return;

    const message = {
      tokens,
      notification: {
        title: String(notification.title || "NEXVADORAQ HireHub").slice(0, 120),
        body: String(notification.message || "ನಿಮಗೆ ಹೊಸ ಮಾಹಿತಿ ಬಂದಿದೆ.").slice(0, 300)
      },
      data: {
        notificationId: String(event.params.notificationId),
        eventType: String(notification.eventType || "hirehub_update"),
        jobId: String(notification.jobId || ""),
        bookingId: String(notification.bookingId || "")
      },
      android: {
        priority: "high",
        notification: { channelId: "default", sound: "default" }
      }
    };
    const result = await getMessaging().sendEachForMulticast(message);
    const invalidTokens = [];
    result.responses.forEach((response, index) => {
      if (!response.success && [
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token"
      ].includes(response.error?.code)) invalidTokens.push(tokens[index]);
    });
    if (invalidTokens.length) {
      const remaining = tokens.filter((token) => !invalidTokens.includes(token));
      await userRef.set({
        fcmTokens: remaining,
        ...(user.fcmToken && invalidTokens.includes(user.fcmToken) ? { fcmToken: "" } : {})
      }, { merge: true });
    }
  }
);
