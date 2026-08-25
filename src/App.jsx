// src/App.jsx
import React, { useEffect, useState } from "react";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Home from "./pages/Home";
import CreateTool from "./pages/CreateTool";
import Settings from "./pages/Settings";
import { signInWithGoogle, auth, doSignOut } from "./firebase";
import { onAuthStateChanged } from "firebase/auth";

export default function App(){
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("home"); // home | create | settings

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
      <Sidebar currentPage={page} setPage={setPage} />
      <div className="main">
        <Header user={user} onSignIn={handleSignIn} onSignOut={handleSignOut} />
        {page === "home" && <Home />}
        {page === "create" && <CreateTool user={user} />}
        {page === "settings" && <Settings user={user} />}
        <div style={{marginTop:20}} className="small-muted">ملاحظة: زر تسجيل الدخول بـ Discord موجود مستقبلاً لكنه مُعطّل حالياً.</div>
      </div>
    </div>
  );
}
