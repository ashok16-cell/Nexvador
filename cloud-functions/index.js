"use strict";
const functions = require("@google-cloud/functions-framework");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
initializeApp();
const db = getFirestore();
const defaultCorsOrigins = [
 "https://nexvadoraq.web.app",
 "https://nexvadoraq.firebaseapp.com",
 "https://localhost",
 "http://localhost",
 "capacitor://localhost"
];
const configuredCorsOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map(s=>s.trim()).filter(Boolean);
const corsOrigins = [...new Set([...defaultCorsOrigins, ...configuredCorsOrigins])];
function fail(code,message){const e=new Error(message);e.status=code;throw e;}
async function authenticate(req){
 const token=(req.headers.authorization||"").match(/^Bearer (.+)$/i)?.[1];
 if(!token)fail(401,"Firebase ID token ಅಗತ್ಯ.");
 return getAuth().verifyIdToken(token,true).catch(()=>fail(401,"Login token ಅಮಾನ್ಯ."));
}
functions.http("hirehubApi",async(req,res)=>{
 res.set("Cache-Control","no-store");
 const origin=req.headers.origin;
 if(origin && corsOrigins.includes(origin)){res.set("Access-Control-Allow-Origin",origin);res.set("Vary","Origin");res.set("Access-Control-Allow-Headers","Authorization,Content-Type");res.set("Access-Control-Allow-Methods","POST,OPTIONS");res.set("Access-Control-Max-Age","3600");}
 if(req.method==="OPTIONS")return res.status(corsOrigins.includes(origin)?204:403).end();
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 try{
  const auth=await authenticate(req);
  const action=String(req.body?.action||"");
  let data;
  if(action==="acceptWorkerBooking")data=await acceptBooking(auth.uid,req.body?.bookingId);
  else if(action==="getOrCreateHireHubDisplayId")data=await createDisplayId(auth.uid,req.body?.newAccount===true);
  else fail(404,"Unknown action");
  return res.status(200).json({data});
 }catch(e){console.error("HireHub API failure",e.code||e.status||500,e.message);return res.status(e.status||500).json({error:e.message||"Server error"});}
});
async function createDisplayId(uid,newAccount){
 const userRef=db.collection("users").doc(uid);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(userRef);if(!snap.exists)fail(404,"User profile ಸಿಗಲಿಲ್ಲ.");
  const user=snap.data()||{};
  const cfg={worker:["1","workerId","worker_numeric_id"],company:["2","companyId","company_numeric_id"],customer:["3","customerId","customer_numeric_id"]}[String(user.role||"").toLowerCase()];
  if(!cfg)fail(403,"ಈ Accountಗೆ Numeric ID ನೀಡಲಾಗುವುದಿಲ್ಲ.");
  const [prefix,field,counter]=cfg;
  const current=String(user.displayId||user[field]||"");
  if(new RegExp("^"+prefix+"[0-9]{5,}$").test(current)){if(user.displayId!==current||user[field]!==current)tx.update(userRef,{displayId:current,[field]:current});return {displayId:current,[field]:current};}
  if(!newAccount)fail(412,"ಹಳೆಯ Accountಗೆ ಹೊಸ Numeric ID ನೀಡುವುದಿಲ್ಲ.");
  const counterRef=db.collection("systemCounters").doc(counter);
  const counterSnap=await tx.get(counterRef);
  let next=Math.max(100000,Number(counterSnap.exists?counterSnap.data().value||0:100000));
  let id,registryRef,registrySnap;
  do{next++;if(!Number.isSafeInteger(next)||next>999999)fail(409,"Numeric ID ಮಿತಿ ಮುಗಿದಿದೆ.");id=prefix+String(next);registryRef=db.collection("hireHubNumericIds").doc(id);registrySnap=await tx.get(registryRef);}while(registrySnap.exists);
  tx.set(counterRef,{value:next,updatedAt:FieldValue.serverTimestamp()},{merge:true});
  tx.create(registryRef,{uid,role:user.role,createdAt:FieldValue.serverTimestamp()});
  tx.update(userRef,{displayId:id,[field]:id});
  return {displayId:id,[field]:id};
 });
}
async function acceptBooking(uid,bookingId){
 bookingId=String(bookingId||"").trim();if(!bookingId||bookingId.length>160)fail(400,"Booking ID ಸರಿಯಾಗಿಲ್ಲ.");
 const userRef=db.collection("users").doc(uid),bookingRef=db.collection("workerBookings").doc(bookingId),lockRef=db.collection("workerActiveBookings").doc(uid);
 return db.runTransaction(async tx=>{
  const userSnap=await tx.get(userRef),bookingSnap=await tx.get(bookingRef),lockSnap=await tx.get(lockRef);
  if(!userSnap.exists||String(userSnap.data()?.role||"").toLowerCase()!=="worker"||userSnap.data()?.active===false)fail(403,"ಸಕ್ರಿಯ Worker ಮಾತ್ರ ಕೆಲಸ ಸ್ವೀಕರಿಸಬಹುದು.");
  if(!bookingSnap.exists)fail(404,"Booking ಸಿಗಲಿಲ್ಲ.");
  const b=bookingSnap.data()||{},status=String(b.status||"Pending").trim().toLowerCase();
  if(!["pending","partially filled"].includes(status))fail(409,"Booking ಮುಚ್ಚಲಾಗಿದೆ.");
  if(b.selectedWorkerId&&String(b.selectedWorkerId)!==uid)fail(403,"Booking ಬೇರೆ Workerಗೆ ಆಯ್ಕೆಯಾಗಿದೆ.");
  const ids=Array.isArray(b.acceptedWorkerIds)?b.acceptedWorkerIds.map(String):(b.workerId?[String(b.workerId)]:[]);
  if(ids.includes(uid))fail(409,"ಈ Booking ಈಗಾಗಲೇ ಸ್ವೀಕರಿಸಿದ್ದೀರಿ.");
  const count=Math.max(1,Number(b.count)||1);
  if(ids.length>=count)fail(409,"Worker ಸ್ಥಾನಗಳು ತುಂಬಿವೆ.");
  if(lockSnap.exists&&String(lockSnap.data()?.bookingId||"")!==bookingId){
   const oldId=String(lockSnap.data()?.bookingId||"");
   if(oldId){const oldSnap=await tx.get(db.collection("workerBookings").doc(oldId));const old=oldSnap.exists?oldSnap.data():null;const oldIds=Array.isArray(old?.acceptedWorkerIds)?old.acceptedWorkerIds.map(String):(old?.workerId?[String(old.workerId)]:[]);if(old&&["Pending","Partially Filled","Confirmed"].includes(String(old.status||"Pending"))&&oldIds.includes(uid))fail(409,"ಇನ್ನೊಂದು Active Booking ಇದೆ: "+oldId);}
  }
  const acceptedWorkerIds=[...ids,uid],remaining=count-acceptedWorkerIds.length;
  const oldRoster=Array.isArray(b.acceptedWorkers)?b.acceptedWorkers:[];
  const acceptedWorkers=ids.map((id,i)=>({workerId:id,workerName:oldRoster.find(x=>String(x?.workerId)===id)?.workerName||(i===0?b.workerName||"Worker":"Worker")}));
  const workerName=String(userSnap.data()?.name||"Worker");acceptedWorkers.push({workerId:uid,workerName});
  const nextStatus=remaining===0?"Confirmed":"Partially Filled",now=FieldValue.serverTimestamp();
  tx.update(bookingRef,{count,acceptedWorkerIds,acceptedWorkers,acceptedCount:acceptedWorkerIds.length,workerId:acceptedWorkerIds[0],workerName:acceptedWorkerIds.length===1?workerName:(b.workerName||workerName),status:nextStatus,acceptedAt:now,updatedAt:now,confirmationMode:"multi-worker-auto-confirm",...(remaining===0?{confirmedAt:now}:{})});
  tx.set(lockRef,{workerId:uid,bookingId,createdAt:now,updatedAt:now});
  return {bookingId,acceptedWorkerIds,acceptedWorkers,acceptedCount:acceptedWorkerIds.length,count,status:nextStatus,remaining,workerName};
 });
}
