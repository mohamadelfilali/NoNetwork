// src/components/Sidebar.jsx
import React from "react";

export default function Sidebar({ currentPage, setPage }){
  return (
    <aside className="sidebar">
      <div className="card">
        <strong>القائمة</strong>
      </div>

      <div className="card" style={{display:"flex",flexDirection:"column",gap:8}}>
        <button className="btn" onClick={()=>setPage("home")}>الرئيسية</button>
        <button className="btn" onClick={()=>setPage("create")}>إنشاء أداة</button>
        <button className="btn" onClick={()=>setPage("settings")}>الإعدادات</button>
      </div>

      <div className="card">
        <div style={{marginBottom:8}}>المكتبة</div>
        <div className="small-muted">الأدوات · الأخبار · مجموعتي</div>
      </div>

      <div className="card">
        <div style={{marginBottom:8}}>سجل النشاط</div>
        <div className="small-muted">يحتفظ بنشاطك محلياً وسحابياً</div>
      </div>

      <div style={{marginTop:12}} className="card">
        <strong>إعدادات</strong>
        <div className="small-muted">تغيير المظهر، ربط الحسابات</div>
      </div>

      <div style={{marginTop:18}} className="small-muted">ملاحظة: تسجيل Discord متاح لكن مُعطّل حالياً.</div>
    </aside>
  );
}
