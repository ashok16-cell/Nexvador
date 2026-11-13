const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

function getFirebaseApp() {
  if (getApps().length) return getApps()[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  return initializeApp({ credential: cert(JSON.parse(raw)) });
}

function response(res, status, body) {
  return res.json(body, status);
}

module.exports = async ({ req, res, log, error }) => {
  try {
    if (req.method !== "POST") return response(res, 405, { error: "method-not-allowed" });
    const authHeader = req.headers["x-firebase-id-token"] ||
      (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!authHeader) return response(res, 401, { error: "unauthenticated", message: "Worker login ಅಗತ್ಯ." });

    const app = getFirebaseApp();
    const decoded = await getAuth(app).verifyIdToken(authHeader);
    const uid = String(decoded.uid || "");
    const bookingId = String(req.body?.bookingId || "").trim();
    if (!bookingId || bookingId.length > 160) {
      return response(res, 400, { error: "invalid-argument", message: "Booking ID ಸರಿಯಾಗಿಲ್ಲ." });
    }

    const db = getFirestore(app);
    const userRef = db.collection("users").doc(uid);
    const bookingRef = db.collection("workerBookings").doc(bookingId);
    const lockRef = db.collection("workerActiveBookings").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const [userSnap, bookingSnap, lockSnap] = await Promise.all([
        tx.get(userRef), tx.get(bookingRef), tx.get(lockRef)
      ]);
      const user = userSnap.data() || {};
      if (!userSnap.exists || String(user.role || "").toLowerCase() !== "worker" || user.active === false) {
        const e = new Error("ಸಕ್ರಿಯ Worker account ಮಾತ್ರ ಕೆಲಸ ಸ್ವೀಕರಿಸಬಹುದು."); e.status = 403; e.code = "permission-denied"; throw e;
      }
      if (!bookingSnap.exists) { const e = new Error("ಕೆಲಸದ Booking ಲಭ್ಯವಿಲ್ಲ."); e.status = 404; e.code = "not-found"; throw e; }
      const b = bookingSnap.data() || {};
      const currentStatus = String(b.status || "Pending");
      if (!["Pending", "Partially Filled"].includes(currentStatus)) {
        const e = new Error("ಈ ಕೆಲಸದ ಎಲ್ಲಾ ಸ್ಥಾನಗಳು ಈಗಾಗಲೇ ತುಂಬಿವೆ ಅಥವಾ Booking ಮುಚ್ಚಲಾಗಿದೆ."); e.status = 409; e.code = "failed-precondition"; throw e;
      }
      if (b.selectedWorkerId && String(b.selectedWorkerId) !== uid) {
        const e = new Error("ಈ Booking ಬೇರೆ Worker‌ಗೆ ಆಯ್ಕೆಯಾಗಿದೆ."); e.status = 403; e.code = "permission-denied"; throw e;
      }
      const ids = Array.isArray(b.acceptedWorkerIds) ? b.acceptedWorkerIds.map(String) : (b.workerId ? [String(b.workerId)] : []);
      if (ids.includes(uid)) { const e = new Error("ನೀವು ಈಗಾಗಲೇ ಈ ಕೆಲಸವನ್ನು ಸ್ವೀಕರಿಸಿದ್ದೀರಿ."); e.status = 409; e.code = "already-exists"; throw e; }
      const required = Math.max(1, Number(b.count) || 1);
      if (ids.length >= required) { const e = new Error("ಎಲ್ಲಾ Worker ಸ್ಥಾನಗಳು ತುಂಬಿವೆ."); e.status = 409; e.code = "failed-precondition"; throw e; }
      if (lockSnap.exists && String(lockSnap.data()?.bookingId || "") !== bookingId) {
        const oldId = String(lockSnap.data()?.bookingId || "");
        if (oldId) {
          const oldSnap = await tx.get(db.collection("workerBookings").doc(oldId));
          const old = oldSnap.exists ? oldSnap.data() || {} : null;
          const oldIds = Array.isArray(old?.acceptedWorkerIds) ? old.acceptedWorkerIds.map(String) : (old?.workerId ? [String(old.workerId)] : []);
          if (old && ["Pending", "Partially Filled", "Confirmed"].includes(String(old.status || "Pending")) && oldIds.includes(uid)) {
            const e = new Error("ನೀವು ಈಗಾಗಲೇ ಮತ್ತೊಂದು Booking ಸ್ವೀಕರಿಸಿದ್ದೀರಿ (" + oldId + "). ಅದನ್ನು Completed, Rejected ಅಥವಾ Cancelled ಮಾಡಿದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."); e.status = 409; e.code = "failed-precondition"; throw e;
          }
        }
      }
      const acceptedIds = [...ids, uid];
      const acceptedCount = acceptedIds.length;
      const remaining = Math.max(0, required - acceptedCount);
      const status = remaining === 0 ? "Confirmed" : "Partially Filled";
      const oldRoster = Array.isArray(b.acceptedWorkers) ? b.acceptedWorkers : [];
      const roster = ids.map((workerId, index) => ({
        workerId,
        workerName: oldRoster.find(x => x && String(x.workerId) === workerId)?.workerName || (index === 0 ? (b.workerName || "Worker") : "Worker")
      }));
      roster.push({ workerId: uid, workerName: String(user.name || "Worker") });
      const now = FieldValue.serverTimestamp();
      tx.update(bookingRef, {
        count: required, acceptedWorkerIds: acceptedIds, acceptedWorkers: roster,
        acceptedCount, workerId: acceptedIds[0],
        workerName: acceptedCount === 1 ? String(user.name || "Worker") : (b.workerName || String(user.name || "Worker")),
        status, acceptedAt: now, updatedAt: now, confirmationMode: "multi-worker-auto-confirm",
        ...(remaining === 0 ? { confirmedAt: now } : {})
      });
      tx.set(lockRef, { workerId: uid, bookingId, createdAt: now, updatedAt: now });
      return { bookingId, acceptedWorkerIds: acceptedIds, acceptedWorkers: roster, acceptedCount, count: required, status, remaining, workerName: String(user.name || "Worker") };
    });

    log("acceptWorkerBooking success: " + bookingId + " by " + uid);
    return response(res, 200, { success: true, ...result });
  } catch (e) {
    error("acceptWorkerBooking failed: " + (e.stack || e.message || String(e)));
    return response(res, Number(e.status) || 500, {
      error: e.code || "internal",
      message: e.status ? e.message : "Booking ಸ್ವೀಕರಿಸುವಾಗ ಸರ್ವರ್ ದೋಷ ಉಂಟಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ."
    });
  }
};
