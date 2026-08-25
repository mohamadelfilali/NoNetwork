import React, { useEffect, useState } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import { signInWithGoogle, auth, doSignOut } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function App(){
  const [user, setUser] = useState(null);

  useEffect(()=>{
    const unsub = onAuthStateChanged(auth, u => {
      setUser(u);
    });
    return () => unsub();
  },[]);

  async function handleSignIn(){
    try{
      const u = await signInWithGoogle();
      setUser(u);
    }catch(e){
      alert("فشل تسجيل الدخول: " + (e.message || e));
    }
  }

  async function handleSignOut(){
    await doSignOut();
    setUser(null);
  }

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Header user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} />
        <Home />
        <div style={{marginTop:20}} className="small-muted">ملاحظة: زر تسجيل الدخول بـ Discord موجود مستقبلاً لكنه مُعطّل حالياً.</div>
      </div>
    </div>
  );
}
