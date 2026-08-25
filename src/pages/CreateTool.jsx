// src/pages/CreateTool.jsx
import React from "react";

export default function CreateTool({ user }){
  return (
    <div>
      <div className="card">
        <h3 style={{marginTop:0}}>إنشاء أداة</h3>
        <div className="small-muted">واجهة بسيطة لإنشاء أداة جديدة (مبدئياً: محرر نصي). ستُطوَّر لاحقاً لمحرر ملفات متعدد ومراجعة مشرف.</div>
      </div>

      <div className="card">
        <label>العنوان</label>
        <input style={{width:"100%",padding:8,marginTop:6,borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}} placeholder="عنوان الأداة..." />

        <label style={{display:"block",marginTop:10}}>الوصف</label>
        <textarea style={{width:"100%",minHeight:120,padding:8,borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}} placeholder="وصف الأداة..." />

        <div style={{marginTop:10}}>
          <button className="btn">حفظ كمسودة</button>
          <button className="btn" style={{marginLeft:8}}>نشر (للشركة)</button>
        </div>
      </div>
    </div>
  );
}
