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


// Notify every active Admin when a worker submits work completion.
// Admin SDK writes bypass client Firestore rules; the client cannot enumerate Admin UIDs.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

exports.notifyAdminOnWorkerCompletion = onDocumentUpdated(
  { document: "workerBookings/{bookingId}", region: "asia-south1" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.workerCompletionStatus === "submitted" ||
        after.workerCompletionStatus !== "submitted") return;

    const db = getFirestore();
    const admins = await db.collection("users").where("role", "==", "admin").get();
    const recipients = admins.docs.filter((doc) => doc.data()?.active !== false);
    if (!recipients.length) {
      console.warn("No active Admin accounts found for worker completion notification.");
      return;
    }

    const workerName = String(after.workerName || after.acceptedWorkerName || "Worker");
    const workName = String(after.category || after.title || "Work");
    const location = String(after.location || after.city || "ಸ್ಥಳ ತಿಳಿಸಿಲ್ಲ");
    const message = `${workerName} ಅವರು ${workName} ಕೆಲಸ ಪೂರ್ಣಗೊಳಿಸಿದ್ದಾಗಿ ತಿಳಿಸಿದ್ದಾರೆ. ಸ್ಥಳ: ${location}. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.`.slice(0, 500);
    const batch = db.batch();
    recipients.forEach((adminDoc) => {
      const ref = db.collection("notifications").doc();
      batch.set(ref, {
        actorId: String(after.workerCompletedBy || after.workerId || "system"),
        recipientId: adminDoc.id,
        title: "Worker Work Complete — Admin Review",
        message,
        eventType: "worker_completion_submitted",
        bookingId: event.params.bookingId,
        createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp(),
        read: false
      });
    });
    await batch.commit();
  }
);


// Separate Super Admin alert when a worker explicitly presses the dedicated button.
exports.notifySuperAdminOnExplicitCompletionNotice = onDocumentUpdated(
  { document: "workerBookings/{bookingId}", region: "asia-south1" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.superAdminCompletionNoticeStatus === "submitted" ||
        after.superAdminCompletionNoticeStatus !== "submitted") return;

    const db = getFirestore();
    const [a, b] = await Promise.all([
      db.collection("users").where("role", "==", "superadmin").get(),
      db.collection("users").where("role", "==", "super_admin").get()
    ]);
    const admins = new Map([...a.docs, ...b.docs].map(doc => [doc.id, doc]));
    const recipients = [...admins.values()].filter(doc => doc.data()?.active !== false);
    if (!recipients.length) {
      console.warn("No active Super Admin accounts found for explicit completion notice.");
      return;
    }
    const workerName = String(after.workerName || after.acceptedWorkerName || "Worker");
    const workName = String(after.category || after.title || "Work");
    const message = `${workerName} ಅವರು ${workName} ಕೆಲಸ ಪೂರ್ಣಗೊಳಿಸಿದ್ದಾಗಿ Super Admin‌ಗೆ ಪ್ರತ್ಯೇಕ ಮಾಹಿತಿ ಕಳುಹಿಸಿದ್ದಾರೆ. Booking ಪರಿಶೀಲಿಸಿ.`.slice(0, 500);
    const batch = db.batch();
    recipients.forEach(doc => {
      batch.set(db.collection("notifications").doc(), {
        actorId: String(after.superAdminCompletionNoticeBy || after.workerCompletedBy || "system"),
        recipientId: doc.id,
        title: "Worker Work Complete — Super Admin Alert",
        message,
        eventType: "superadmin_worker_completion_notice",
        bookingId: event.params.bookingId,
        createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp(),
        read: false
      });
    });
    await batch.commit();
  }
);
