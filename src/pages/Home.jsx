import React from "react";

export default function Home(){
  // عرض تجريبي لبطاقات الأدوات
  const demoTools = [
    {id:1, title:"أداة توليد ألوان", desc:"أداة بسيطة لتوليد ألوان من صورة"},
    {id:2, title:"منسق نصوص", desc:"تنسيق ونسق النصوص سريعا"},
    {id:3, title:"مقارنة أكواد", desc:"قارن بين نصين من الكود بسرعة"}
  ];

  return (
    <div>
      <div className="card top-hero">
        <div style={{flex:1}}>
          <h3 style={{margin:"0 0 6px 0"}}>مرحباً بك في NoNetwork</h3>
          <div className="small-muted">استعرض الأدوات، أنشئ أدواتك، واحفظ المفضلة.</div>
        </div>
      </div>

      <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px,1fr))", gap:12}}>
        {demoTools.map(t => (
          <div key={t.id} className="card">
            <h4 style={{margin:"0 0 6px 0"}}>{t.title}</h4>
            <div className="small-muted">{t.desc}</div>
            <div style={{marginTop:10}}>
              <button className="btn">فتح</button>
              <button style={{marginLeft:8}} className="btn">حفظ</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
