// classApi.js
// Lightweight helper module for Classroom Points data access.
// Works with Firebase Web SDK v10+ (CDN imports).

// --- Firebase SDK imports (ESM via CDN) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, writeBatch,
  onSnapshot, query, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---------- 0) Bootstrap ----------
export function initFirebase(config) {
  // Tip: don’t run from file:// — auth popups often fail. Use a local server.
  if (location.protocol === "file:") {
    console.warn("Serve over http(s). Google sign-in may fail on file://");
  }
  const app = initializeApp(config);
  const db = getFirestore(app);
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  return { app, db, auth, provider };
}

// ---------- 1) Auth helpers ----------
export const isSignedIn = (auth) => !!auth.currentUser;

/** Call once; gets called whenever the user signs in/out */
export function observeAuth(auth, onChange) {
  return onAuthStateChanged(auth, onChange);
}

/** Opens Google sign-in popup */
export async function signInWithGoogle(auth, provider) {
  await signInWithPopup(auth, provider);
}

/** Signs out current user */
export async function signOutUser(auth) {
  await signOut(auth);
}

// ---------- 2) Class list & metadata ----------
/** Returns an array like [{id, displayName, idPrefix}] one time (no live updates) */
export async function listClasses(db) {
  const snap = await getDocs(collection(db, "classes"));
  return snap.docs.map(d => {
    const data = d.data() || {};
    return { id: d.id, displayName: data.displayName || d.id, idPrefix: data.idPrefix || "" };
  }).sort((a,b) => a.displayName.localeCompare(b.displayName, undefined, { numeric:true, sensitivity:"base" }));
}

/** Live-watch a class (meta + students). Returns an unsubscribe function. */
export function watchClass(db, classId, { onMeta, onStudents, onError } = {}) {
  const classRef = doc(db, "classes", classId);
  const unsubMeta = onSnapshot(classRef, snap => {
    const data = snap.data() || {};
    onMeta?.({
      id: classId,
      displayName: data.displayName || classId,
      idPrefix: data.idPrefix || ""
    });
  }, onError);

  const unsubStudents = onSnapshot(
    query(collection(db, "classes", classId, "students")),
    snap => {
      const rows = snap.docs.map(d => {
        const s = d.data() || {};
        return {
          id: d.id,
          name: s.name || "",
          points: (s.points && typeof s.points.total === "number") ? s.points.total : 0,
          daily:  (s.points && typeof s.points.daily === "number") ? s.points.daily  : 0,
          // include all data in case you store extra fields later
          _raw: s
        };
      });
      onStudents?.(rows);
    },
    onError
  );

  return () => { unsubMeta?.(); unsubStudents?.(); };
}

// ---------- 3) Class CRUD ----------
/** Create or update a class doc with displayName + idPrefix */
export async function createClass(db, displayName, idPrefix) {
  if (!displayName || !idPrefix) throw new Error("displayName and idPrefix required");
  await setDoc(
    doc(db, "classes", displayName),
    { displayName, idPrefix, createdAt: Date.now() },
    { merge: true }
  );
}

/** Delete a class and all its students */
export async function deleteClass(db, classId) {
  // delete students first
  const students = await getDocs(collection(db, "classes", classId, "students"));
  let batch = writeBatch(db); let ops = 0;
  for (const d of students.docs) {
    batch.delete(doc(db, "classes", classId, "students", d.id));
    if (++ops % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  await deleteDoc(doc(db, "classes", classId));
}

// ---------- 4) Student helpers ----------
/** Get one student object { id, ...data } */
export async function getStudent(db, classId, studentId) {
  const snap = await getDoc(doc(db, "classes", classId, "students", studentId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Add or update one student with partial fields (safe merge) */
export async function setStudent(db, classId, studentId, fields) {
  await setDoc(doc(db, "classes", classId, "students", studentId), fields, { merge: true });
}

/** Batch save: adds[], edits[], dels[] in one commit */
export async function saveStudentsBatch(db, classId, { adds = [], edits = [], dels = [] }) {
  const base = ["classes", classId, "students"];
  const batch = writeBatch(db);

  dels.forEach(id => batch.delete(doc(db, ...base, id)));

  adds.forEach(s => {
    const id = s.id || required("adds[].id");
    batch.set(doc(db, ...base, id), normalizeStudent(s), { merge: true });
  });

  edits.forEach(s => {
    const id = s.id || required("edits[].id");
    batch.set(doc(db, ...base, id), normalizeStudent(s), { merge: true });
  });

  await batch.commit();
}

// ---------- 5) “Common actions” you’ll reuse ----------
/** Increment a student's points: {daily += d, total += t} (defaults: +1/+1) */
export async function incrementPoints(db, classId, studentId, { daily = 1, total = 1 } = {}) {
  const cur = await getStudent(db, classId, studentId) || {};
  const pts = cur.points || { daily: 0, total: 0 };
  await setStudent(db, classId, studentId, { points: { daily: toInt(pts.daily) + daily, total: toInt(pts.total) + total } });
}

/** Reset daily points for one student */
export async function resetDaily(db, classId, studentId) {
  const cur = await getStudent(db, classId, studentId); if (!cur) return;
  await setStudent(db, classId, studentId, { points: { daily: 0, total: toInt(cur.points?.total) } });
}

/** Reset total points for one student */
export async function resetTotal(db, classId, studentId) {
  const cur = await getStudent(db, classId, studentId); if (!cur) return;
  await setStudent(db, classId, studentId, { points: { daily: toInt(cur.points?.daily), total: 0 } });
}

/** Add +1 daily to *all* students in a class (merge-safe) */
export async function addDailyToAll(db, classId) {
  const snap = await getDocs(collection(db, "classes", classId, "students"));
  const batch = writeBatch(db);
  snap.forEach(d => {
    const s = d.data() || {};
    const pts = s.points || { daily: 0, total: 0 };
    batch.set(doc(db, "classes", classId, "students", d.id), {
      ...s,
      points: { daily: toInt(pts.daily) + 1, total: toInt(pts.total) + 1 }
    }, { merge: true });
  });
  await batch.commit();
}

/** Write a custom string field for “virtual pets”, notes, etc. */
export async function setStudentString(db, classId, studentId, key, value) {
  // Example: key = "petName" or "petMood" or "note"
  if (typeof value !== "string") throw new Error("value must be a string");
  await setStudent(db, classId, studentId, { [key]: value });
}

// ---------- 6) Small utilities ----------
export const toInt = (n) => Math.max(0, Math.trunc(Number(n) || 0));

function required(what) { throw new Error(`Missing: ${what}`); }

function normalizeStudent(s) {
  // Make sure points object is normalized and safe to merge
  const base = { name: s.name ?? "", points: {} };
  const daily = s.daily ?? s.points?.daily;
  const total = s.points?.total ?? s.total ?? s.points;
  const points = {
    daily: toInt(daily || 0),
    total: toInt(total || 0)
  };
  return { ...base, id: s.id, points, ...s._extra };
}
