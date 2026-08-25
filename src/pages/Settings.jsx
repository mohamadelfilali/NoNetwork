// src/pages/Settings.jsx
import React, { useEffect, useState, useRef } from "react";
import { auth, db, storage } from "../firebase";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadString, getDownloadURL } from "firebase/storage";

function toHex([r,g,b]){
  const h = (n) => n.toString(16).padStart(2,"0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function luminance(r,g,b){
  // r,g,b in [0,255]
  const s = [r,g,b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  });
  return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2];
}

function contrastRatio(rgbA, rgbB){
  const L1 = luminance(...rgbA);
  const L2 = luminance(...rgbB);
  const lighter = Math.max(L1,L2);
  const darker = Math.min(L1,L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function reduceColor([r,g,b]){
  // reduce to 12-bit (4 bits per channel) to bucket similar colors
  return [(r >> 4) << 4, (g >> 4) << 4, (b >> 4) << 4];
}

export default function Settings({ user }){
  const [themeMode, setThemeMode] = useState("dark"); // 'dark' | 'light' | 'custom'
  const [bgDataUrl, setBgDataUrl] = useState(null);
  const [dominantColor, setDominantColor] = useState("#000000");
  const [textColor, setTextColor] = useState("#ffffff");
  const [overlay, setOverlay] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  useEffect(()=>{
    // try load local settings
    try{
      const raw = localStorage.getItem("nonetwork_settings_v1");
      if(raw){
        const s = JSON.parse(raw);
        if(s.themeMode) setThemeMode(s.themeMode);
        if(s.bg) setBgDataUrl(s.bg);
        if(s.dominantColor) setDominantColor(s.dominantColor);
        if(s.textColor) setTextColor(s.textColor);
        if(typeof s.overlay === "boolean") setOverlay(s.overlay);
      }
    }catch(e){ console.warn("load settings failed", e); }
  },[]);

  async function handleFile(e){
    const f = e.target.files?.[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setBgDataUrl(dataUrl);
      // compute dominant color
      try{
        const dom = await extractDominantColor(dataUrl);
        setDominantColor(dom);
        decideTextColor(dom);
        setThemeMode("custom");
      }catch(err){
        console.error("color extraction failed", err);
      }
    };
    reader.readAsDataURL(f);
  }

  async function extractDominantColor(dataUrl){
    // create image, draw to small canvas, sample pixels, bucket by reduced color
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try{
          const w = 80; // small sample size for speed
          const h = Math.round((img.height / img.width) * w);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = Math.max(1,h);
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;
          const counts = new Map();
          for(let i=0;i<data.length;i+=4){
            const alpha = data[i+3];
            if(alpha < 125) continue; // ignore transparent-ish
            const r = data[i], g = data[i+1], b = data[i+2];
            const reduced = reduceColor([r,g,b]);
            const key = reduced.join(",");
            counts.set(key, (counts.get(key)||0) + 1);
          }
          // find largest bucket
          let bestKey=null, bestCount=0;
          for(const [k,c] of counts.entries()){
            if(c > bestCount){
              bestCount = c;
              bestKey = k;
            }
          }
          if(!bestKey){
            resolve("#000000");
            return;
          }
          const rgb = bestKey.split(",").map(n => parseInt(n,10));
          resolve(toHex(rgb));
        }catch(err){
          reject(err);
        }
      };
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }

  function decideTextColor(hex){
    // convert hex to rgb
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const ratioWhite = contrastRatio([r,g,b],[255,255,255]);
    const ratioBlack = contrastRatio([r,g,b],[0,0,0]);
    // prefer higher contrast; require at least 4.5 for normal text ideally
    setTextColor(ratioWhite >= ratioBlack ? "#ffffff" : "#000000");
  }

  async function handleSave(){
    setSaving(true);
    try{
      // save locally
      const settings = {
        themeMode, bg: bgDataUrl, dominantColor, textColor, overlay
      };
      localStorage.setItem("nonetwork_settings_v1", JSON.stringify(settings));

      // if logged-in, upload background to Storage and save to Firestore
      if(user){
        const uid = user.uid;
        let backgroundUrl = null;
        if(bgDataUrl){
          const path = `users/${uid}/background.png`;
          const ref = storageRef(storage, path);
          // upload as base64 data_url
          await uploadString(ref, bgDataUrl, 'data_url');
          backgroundUrl = await getDownloadURL(ref);
        }
        const userDoc = doc(db, "users", uid);
        // write or merge settings
        await setDoc(userDoc, {
          settings: {
            themeMode,
            dominantColor,
            textColor,
            overlay,
            backgroundUrl: backgroundUrl || null,
            updatedAt: serverTimestamp()
          }
        }, { merge: true });
      }

      alert("تم حفظ الإعدادات.");
    }catch(err){
      console.error("save settings failed", err);
      alert("فشل حفظ الإعدادات: " + (err.message || err));
    }finally{
      setSaving(false);
    }
  }

  function handleRemoveBackground(){
    setBgDataUrl(null);
    setDominantColor("#000000");
    setTextColor("#ffffff");
    setThemeMode("dark");
    fileRef.current.value = "";
  }

  // show linked providers from Firebase user object (if provided)
  const providers = (user && user.providerData) ? user.providerData.map(p => p.providerId) : [];

  return (
    <div>
      <div className="card">
        <h3 style={{marginTop:0}}>الإعدادات</h3>
        <div className="small-muted">تحكّم في المظهر، الحسابات المرتبطة وإعداداتك الشخصية.</div>
      </div>

      <div className="card">
        <h4>المظهر</h4>

        <div style={{marginTop:8}}>
          <label style={{display:"block",marginBottom:6}}>
            <input type="radio" checked={themeMode === "light"} onChange={()=>setThemeMode("light")} /> {' '}وضع فاتح
          </label>
          <label style={{display:"block",marginBottom:6}}>
            <input type="radio" checked={themeMode === "dark"} onChange={()=>setThemeMode("dark")} /> {' '}وضع داكن
          </label>
          <label style={{display:"block",marginBottom:6}}>
            <input type="radio" checked={themeMode === "custom"} onChange={()=>setThemeMode("custom")} /> {' '}خلفية مخصّصة (رفع صورة)
          </label>
        </div>

        {themeMode === "custom" && (
          <div style={{marginTop:12}}>
            <div style={{marginBottom:8}}>ارفع صورة الخلفية (JPEG/PNG):</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} />
            {bgDataUrl && (
              <div style={{marginTop:12}}>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <div style={{width:120,height:80,backgroundImage:`url(${bgDataUrl})`, backgroundSize:"cover", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)"}} />
                  <div>
                    <div className="small-muted">اللون السائد المقترح:</div>
                    <div style={{display:"flex",gap:8,alignItems:"center",marginTop:6}}>
                      <div style={{width:48,height:48,background:dominantColor,borderRadius:8,border:"1px solid rgba(255,255,255,0.06)"}} />
                      <div>
                        <div>{dominantColor}</div>
                        <div className="small-muted">لون النص المقترح: <strong>{textColor}</strong></div>
                      </div>
                    </div>

                    <div style={{marginTop:10}}>
                      <label style={{display:"flex",gap:8,alignItems:"center"}}>
                        <input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)} />
                        <span className="small-muted">إضافة overlay شفافة لتحسين التباين</span>
                      </label>
                    </div>

                    <div style={{marginTop:10}}>
                      <button className="btn" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ الإعداد"}</button>
                      <button style={{marginLeft:8}} className="btn" onClick={handleRemoveBackground}>إزالة الخلفية</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!bgDataUrl && (
              <div style={{marginTop:10}} className="small-muted">لم تُرفع صورة بعد.</div>
            )}
          </div>
        )}

        {themeMode !== "custom" && (
          <div style={{marginTop:12}}>
            <button className="btn" onClick={handleSave} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ المظهر"}</button>
          </div>
        )}

      </div>

      <div className="card">
        <h4>الحسابات المرتبطة</h4>
        <div className="small-muted" style={{marginBottom:8}}>المزودات المرتبطة بحسابك الآن:</div>
        <ul>
          {providers.length ? providers.map(p => (
            <li key={p}>{p}</li>
          )) : <li className="small-muted">لم تقم بتسجيل الدخول بعد</li>}
        </ul>

        <div style={{marginTop:10}}>
          <div className="small-muted">تسجيل الدخول عبر Google مفعل عبر Firebase. <br/>تسجيل Discord موجود لكن مُعطّل حالياً.</div>
          <div style={{marginTop:8}}>
            <button className="btn" disabled>ربط Discord (مُعطّل)</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h4>حفظ محلي</h4>
        <div className="small-muted">الإعدادات تحفظ محليًا في المتصفح، ويمكن أيضًا حفظها في حسابك (إن كنت مسجلًا).</div>
      </div>
    </div>
  );
}
