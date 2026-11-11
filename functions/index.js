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


// One completion event fans out to the booking customer/requester and every active Admin,
// including Super Admin accounts (role=admin/adminLevel=super or legacy superadmin roles).
exports.notifyAllOnWorkerCompletion = onDocumentUpdated(
  { document: "workerBookings/{bookingId}", region: "asia-south1" },
  async (event) => {
    const before = event.data?.before?.data() || {};
    const after = event.data?.after?.data() || {};
    if (before.workerCompletionStatus === "submitted" ||
        after.workerCompletionStatus !== "submitted") return;

    const db = getFirestore();
    const [admins, superAdmins, legacySuperAdmins] = await Promise.all([
      db.collection("users").where("role", "==", "admin").get(),
      db.collection("users").where("role", "==", "superadmin").get(),
      db.collection("users").where("role", "==", "super_admin").get()
    ]);
    const recipients = new Map();
    [admins, superAdmins, legacySuperAdmins].forEach(snapshot => {
      snapshot.docs.forEach(doc => {
        if (doc.data()?.active !== false) recipients.set(doc.id, doc.id);
      });
    });
    [after.requesterId, after.customerId, after.companyId].forEach(uid => {
      if (typeof uid === "string" && uid && uid !== after.workerCompletedBy) recipients.set(uid, uid);
    });
    recipients.delete(String(after.workerCompletedBy || ""));
    if (!recipients.size) {
      console.warn("No customer or Admin recipients found for worker completion.", event.params.bookingId);
      return;
    }

    const workerName = String(after.workerName || after.acceptedWorkerName || "Worker");
    const workName = String(after.category || after.title || "Work");
    const location = String(after.location || after.city || "ಸ್ಥಳ ತಿಳಿಸಿಲ್ಲ");
    const message = `${workerName} ಅವರು ${workName} ಕೆಲಸ ಪೂರ್ಣಗೊಳಿಸಿದ್ದಾಗಿ ತಿಳಿಸಿದ್ದಾರೆ. ಸ್ಥಳ: ${location}. ದಯವಿಟ್ಟು ಪರಿಶೀಲಿಸಿ.`.slice(0, 500);
    const batch = db.batch();
    recipients.forEach(uid => {
      batch.set(db.collection("notifications").doc(), {
        actorId: String(after.workerCompletedBy || "system"),
        recipientId: uid,
        title: "Worker Work Complete — Review Required",
        message,
        eventType: "worker_completion_submitted",
        bookingId: event.params.bookingId,
        createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp(),
        read: false
      });
    });
    await batch.commit();
    console.log("Worker completion notifications delivered to", recipients.size, "recipients.");
  }
);
