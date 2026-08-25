import React from "react";

export default function Header({ user, onSignIn, onSignOut }) {
  return (
    <div className="header">
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <h2 style={{margin:0}}>NoNetwork</h2>
        <div className="small-muted">منصة الأدوات والمقالات</div>
      </div>
      <div style={{display:"flex",gap:10,alignItems:"center"}}>
        {user ? (
          <>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <img src={user.photoURL || "https://www.gravatar.com/avatar?d=mp"} alt="avatar" style={{width:36,height:36,borderRadius:10}}/>
              <div className="small-muted">{user.displayName || user.email}</div>
            </div>
            <button className="btn" onClick={onSignOut}>خروج</button>
          </>
        ) : (
          <button className="btn" onClick={onSignIn}>تسجيل الدخول بـ Google</button>
        )}
      </div>
    </div>
  );
}
