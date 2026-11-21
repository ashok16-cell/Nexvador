const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
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
    // Deterministic IDs make this trigger idempotent: duplicate event delivery
    // updates the same notification instead of creating duplicate alerts.
    const batch = db.batch();
    recipients.forEach(uid => {
      const notificationId = `worker_completion_${event.params.bookingId}_${uid}`;
      batch.set(db.collection("notifications").doc(notificationId), {
        actorId: String(after.workerCompletedBy || "system"),
        recipientId: uid,
        title: "Worker Work Complete — Review Required",
        message,
        eventType: "worker_completion_submitted",
        bookingId: event.params.bookingId,
        createdAt: require("firebase-admin/firestore").FieldValue.serverTimestamp(),
        read: false
      }, { merge: true });
    });
    await batch.commit();
    console.log("Worker completion notifications delivered to", recipients.size, "recipients.");
  }
);


// Deployment marker: ensure getOrCreateHireHubDisplayId is deployed to asia-south1 with the current HireHub backend.
// Assign a unique numeric public HireHub ID to newly registered Worker, Company and Customer accounts.
exports.getOrCreateHireHubDisplayId = onCall({ region: "asia-south1" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Login ಅಗತ್ಯ.");
  const db = getFirestore(), uid = request.auth.uid;
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "User profile ಸಿಗಲಿಲ್ಲ.");
    const user = userSnap.data() || {}, role = String(user.role || "").toLowerCase();
    const config = {
      worker: { prefix: "1", field: "workerId", counter: "worker_numeric_id" },
      company: { prefix: "2", field: "companyId", counter: "company_numeric_id" },
      customer: { prefix: "3", field: "customerId", counter: "customer_numeric_id" }
    }[role];
    if (!config) throw new HttpsError("failed-precondition", "ಈ accountಗೆ Numeric ID ನೀಡಲಾಗುವುದಿಲ್ಲ.");
    const current = String(user.displayId || user[config.field] || "");
    if (new RegExp("^" + config.prefix + "[0-9]{5,}$").test(current)) {
      if (user.displayId !== current || user[config.field] !== current) tx.update(userRef, { displayId: current, [config.field]: current });
      return { displayId: current, [config.field]: current };
    }
    if (request.data?.newAccount !== true) throw new HttpsError("failed-precondition", "ಹಳೆಯ Accountಗೆ ಹೊಸ Numeric ID ನೀಡುವುದಿಲ್ಲ.");
    const counterRef = db.collection("systemCounters").doc(config.counter);
    const counterSnap = await tx.get(counterRef);
    let next = Math.max(100000, Number(counterSnap.exists ? counterSnap.data().value || 0 : 100000));
    let numericId, registryRef, registrySnap;
    do {
      next++;
      if (!Number.isSafeInteger(next) || next > 999999) throw new HttpsError("resource-exhausted", "Numeric ID ಮಿತಿ ಮುಗಿದಿದೆ.");
      numericId = config.prefix + String(next);
      registryRef = db.collection("hireHubNumericIds").doc(numericId);
      registrySnap = await tx.get(registryRef);
    } while (registrySnap.exists);
    const now = require("firebase-admin/firestore").FieldValue.serverTimestamp();
    tx.set(counterRef, { value: next, updatedAt: now }, { merge: true });
    tx.create(registryRef, { uid, role, createdAt: now });
    tx.update(userRef, { displayId: numericId, [config.field]: numericId });
    return { displayId: numericId, [config.field]: numericId };
  });
});


/**
 * Secure worker booking acceptance. Admin SDK performs the atomic booking + active-lock
 * transaction after verifying the caller's authenticated worker profile.
 */
exports.acceptWorkerBooking = onCall({ region: "asia-south1", memory: "256MiB" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Worker login ಅಗತ್ಯ.");
  const uid = String(request.auth.uid);
  const bookingId = String(request.data?.bookingId || "").trim();
  if (!bookingId || bookingId.length > 160) throw new HttpsError("invalid-argument", "Booking ID ಸರಿಯಾಗಿಲ್ಲ.");
  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const bookingRef = db.collection("workerBookings").doc(bookingId);
  const lockRef = db.collection("workerActiveBookings").doc(uid);
  let stage = "transaction-start";
  try {
    return await db.runTransaction(async (tx) => {
      stage = "read-worker-profile";
      // Keep transaction reads sequential and complete all reads before any write.
      const userSnap = await tx.get(userRef);
      stage = "read-booking";
      const bookingSnap = await tx.get(bookingRef);
      stage = "read-worker-active-lock";
      const lockSnap = await tx.get(lockRef);
      if (!userSnap.exists || String(userSnap.data()?.role || "").toLowerCase() !== "worker" || userSnap.data()?.active === false) {
        throw new HttpsError("permission-denied", "ಸಕ್ರಿಯ Worker account ಮಾತ್ರ ಕೆಲಸ ಸ್ವೀಕರಿಸಬಹುದು.");
      }
      if (!bookingSnap.exists) throw new HttpsError("not-found", "ಕೆಲಸದ Booking ಲಭ್ಯವಿಲ್ಲ.");
      const b = bookingSnap.data() || {};
      const currentStatus = String(b.status || "Pending").trim().toLowerCase();
      if (!["pending", "partially filled"].includes(currentStatus)) {
        throw new HttpsError("failed-precondition", "ಈ ಕೆಲಸದ ಎಲ್ಲಾ ಸ್ಥಾನಗಳು ಈಗಾಗಲೇ ತುಂಬಿವೆ ಅಥವಾ Booking ಮುಚ್ಚಲಾಗಿದೆ.");
      }
      if (b.selectedWorkerId && String(b.selectedWorkerId) !== uid) {
        throw new HttpsError("permission-denied", "ಈ Booking ಬೇರೆ Worker‌ಗೆ ಆಯ್ಕೆಯಾಗಿದೆ.");
      }
      const ids = Array.isArray(b.acceptedWorkerIds) ? b.acceptedWorkerIds.map(String) : (b.workerId ? [String(b.workerId)] : []);
      if (ids.includes(uid)) throw new HttpsError("already-exists", "ನೀವು ಈಗಾಗಲೇ ಈ ಕೆಲಸವನ್ನು ಸ್ವೀಕರಿಸಿದ್ದೀರಿ.");
      const required = Math.max(1, Number(b.count) || 1);
      if (ids.length >= required) throw new HttpsError("failed-precondition", "ಎಲ್ಲಾ Worker ಸ್ಥಾನಗಳು ತುಂಬಿವೆ.");
      if (lockSnap.exists && String(lockSnap.data()?.bookingId || "") !== bookingId) {
        const oldId = String(lockSnap.data()?.bookingId || "");
        if (oldId) {
          const oldSnap = await tx.get(db.collection("workerBookings").doc(oldId));
          const old = oldSnap.exists ? oldSnap.data() || {} : null;
          const oldIds = Array.isArray(old?.acceptedWorkerIds) ? old.acceptedWorkerIds.map(String) : (old?.workerId ? [String(old.workerId)] : []);
          if (old && ["Pending", "Partially Filled", "Confirmed"].includes(String(old.status || "Pending")) && oldIds.includes(uid) && !(String(old.status || "").toLowerCase() === "completed" && old.customerCompletionConfirmed === true)) {
            throw new HttpsError("failed-precondition", "ನೀವು ಈಗಾಗಲೇ ಮತ್ತೊಂದು Booking ಸ್ವೀಕರಿಸಿದ್ದೀರಿ (" + oldId + "). ಅದನ್ನು Completed, Rejected ಅಥವಾ Cancelled ಮಾಡಿದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.");
          }
        }
      }
      stage = "prepare-acceptance";
      const acceptedIds = [...ids, uid];
      const acceptedCount = acceptedIds.length;
      const remaining = Math.max(0, required - acceptedCount);
      const status = remaining === 0 ? "Confirmed" : "Partially Filled";
      const oldRoster = Array.isArray(b.acceptedWorkers) ? b.acceptedWorkers : [];
      const roster = ids.map((workerId, index) => ({
        workerId,
        workerName: oldRoster.find(x => x && String(x.workerId) === workerId)?.workerName || (index === 0 ? (b.workerName || "Worker") : "Worker")
      }));
      roster.push({ workerId: uid, workerName: String(userSnap.data()?.name || "Worker") });
      const now = require("firebase-admin/firestore").FieldValue.serverTimestamp();
      stage = "write-booking-and-worker-lock";
      tx.update(bookingRef, {
        count: required, acceptedWorkerIds: acceptedIds, acceptedWorkers: roster,
        acceptedCount, workerId: acceptedIds[0],
        workerName: acceptedCount === 1 ? String(userSnap.data()?.name || "Worker") : (b.workerName || String(userSnap.data()?.name || "Worker")),
        status, acceptedAt: now, updatedAt: now, confirmationMode: "multi-worker-auto-confirm",
        ...(remaining === 0 ? { confirmedAt: now } : {})
      });
      tx.set(lockRef, { workerId: uid, bookingId, createdAt: now, updatedAt: now });
      stage = "transaction-committed";
      return { bookingId, acceptedWorkerIds: acceptedIds, acceptedWorkers: roster, acceptedCount, count: required, status, remaining, workerName: String(userSnap.data()?.name || "Worker") };
    });
  } catch (error) {
    console.error("acceptWorkerBooking failed", { uid, bookingId, stage, code: error?.code || "unknown", message: error?.message || String(error), stack: error?.stack });
    if (error instanceof HttpsError) throw error;
    // Preserve a safe, actionable diagnostic for the authenticated worker client.
    // Keep the full stack in Cloud Logging; expose only stage and a bounded cause.
    const cause = String(error?.message || error || "Unknown server error").slice(0, 300);
    console.error("acceptWorkerBooking diagnostic", JSON.stringify({ uid, bookingId, stage, code: error?.code || "unknown", cause }));
    throw new HttpsError("internal", "Booking ಸ್ವೀಕರಿಸುವಾಗ ಸರ್ವರ್ ದೋಷ ಉಂಟಾಗಿದೆ.", { stage, cause });
  }
});


// Customer confirms the worker's submitted completion. Only then is the worker's active lock released.
exports.confirmWorkerCompletion = onCall({ region: "asia-south1", memory: "256MiB" }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Customer login ಅಗತ್ಯ.");
  const uid = String(request.auth.uid);
  const bookingId = String(request.data?.bookingId || "").trim();
  if (!bookingId || bookingId.length > 160) throw new HttpsError("invalid-argument", "Booking ID ಸರಿಯಾಗಿಲ್ಲ.");
  const db = getFirestore();
  const bookingRef = db.collection("workerBookings").doc(bookingId);
  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking ಸಿಗಲಿಲ್ಲ.");
    const booking = bookingSnap.data() || {};
    const customerId = String(booking.requesterId || booking.customerId || booking.companyId || "");
    if (customerId !== uid) throw new HttpsError("permission-denied", "ಈ Booking‌ನ Customer ಮಾತ್ರ ಕೆಲಸ ಪೂರ್ಣಗೊಂಡಿದೆ ಎಂದು ದೃಢೀಕರಿಸಬಹುದು.");
    if (String(booking.workerCompletionStatus || "").toLowerCase() !== "submitted") {
      throw new HttpsError("failed-precondition", "Worker ಇನ್ನೂ Work Complete ಸಲ್ಲಿಸಿಲ್ಲ.");
    }
    if (booking.customerCompletionConfirmed === true && String(booking.status || "").toLowerCase() === "completed") {
      return { bookingId, status: "Completed", alreadyConfirmed: true };
    }
    const workerIds = Array.isArray(booking.acceptedWorkerIds)
      ? booking.acceptedWorkerIds.map(String)
      : (booking.workerId ? [String(booking.workerId)] : []);
    const lockRefs = workerIds.map(workerId => db.collection("workerActiveBookings").doc(workerId));
    const lockSnaps = [];
    for (const lockRef of lockRefs) lockSnaps.push(await tx.get(lockRef));
    const now = FieldValue.serverTimestamp();
    tx.update(bookingRef, {
      status: "Completed",
      customerCompletionConfirmed: true,
      customerCompletionConfirmedBy: uid,
      customerCompletionConfirmedAt: now,
      completedAt: now,
      updatedAt: now
    });
    lockSnaps.forEach((snap, index) => {
      if (snap.exists && String(snap.data()?.bookingId || "") === bookingId) tx.delete(lockRefs[index]);
    });
    return { bookingId, status: "Completed", releasedWorkerCount: lockSnaps.filter((snap, index) => snap.exists && String(snap.data()?.bookingId || "") === bookingId).length };
  });
});
