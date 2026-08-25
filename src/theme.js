// src/theme.js
// دالة لتطبيق إعدادات الواجهة (theme) عبر CSS variables
export function applyTheme(settings = {}) {
  const root = document.documentElement;
  const mode = settings.themeMode || "dark"; // light | dark | custom
  const dominant = settings.dominantColor || "#0f1724";
  const text = settings.textColor || (mode === "light" ? "#000000" : "#e6eef8");
  const overlayOn = !!settings.overlay;
  const bgData = settings.bg || null; // dataURL (local) أو null

  // background fallback gradient (when no image)
  const fallbackLight = "linear-gradient(180deg,#f5f7fb,#e6eef8)";
  const fallbackDark = `linear-gradient(180deg, ${dominant}, #071020)`;

  // set basic variables
  root.style.setProperty("--dominant-color", dominant);
  root.style.setProperty("--text-color", text);
  root.style.setProperty("--accent", settings.accent || dominant || "#5eead4");

  // handle bg image vs fallback
  if (mode === "custom" && bgData) {
    // store as url(...) string so CSS can use var(--bg-image)
    root.style.setProperty("--bg-image", `url("${bgData}")`);
    root.style.setProperty("--bg-fallback", fallbackDark);
  } else {
    root.style.setProperty("--bg-image", "none");
    root.style.setProperty("--bg-fallback", mode === "light" ? fallbackLight : fallbackDark);
  }

  // overlay color: choose white or black overlay depending on text color (to improve contrast)
  let overlayColor = "transparent";
  if (overlayOn) {
    if (text === "#ffffff" || text.toLowerCase() === "white") {
      // darken image for white text
      overlayColor = "rgba(0,0,0,0.35)";
    } else {
      // lighten image for dark text
      overlayColor = "rgba(255,255,255,0.30)";
    }
  }
  root.style.setProperty("--overlay-color", overlayColor);

  // compatibility variables used previously in CSS
  root.style.setProperty("--bg", "var(--bg-fallback)");
  root.style.setProperty("--card", "rgba(255,255,255,0.03)");
  root.style.setProperty("--text", "var(--text-color)");
}
