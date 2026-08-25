// ملف التهيئة العامة لفايربيس
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
// ضع ملف src/firebaseConfig.js بنفس مسار المثال واملأ القيم
import { firebaseConfig } from "./firebaseConfig";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export async function signInWithGoogle(){
  try{
    const res = await signInWithPopup(auth, googleProvider);
    return res.user;
  }catch(e){
    console.error("google sign-in failed", e);
    throw e;
  }
}

export async function doSignOut(){
  await signOut(auth);
}
