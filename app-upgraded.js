/* No Network — frontend client
   Compatible with the existing Apps Script actions:
   register_or_login, find_friend, get_messages, send_message, update_profile.
   The optional conversation discovery layer tries get_conversations/get_inbox so
   a recipient can see a new sender automatically after the backend exposes it.
*/

const API_URL = "https://script.google.com/macros/s/AKfycbxsJaY5cNNWe2sgzKZURjx5aIC_Ku2cJCS49a5CZiFNQfYtYasERTCs4WMCDoV3porPZQ/exec";
const POLL_MS = 1500;
const DISCOVERY_MS = 2200;
const MAX_IMAGE_BYTES = 1_200_000;

let currentUser = safeJson(localStorage.getItem("nn_user"), null);
let currentChatFriend = null;
let friends = safeJson(localStorage.getItem("nn_friends"), []);
let selectedImageBase64 = "";
let selectedImageObjectUrl = "";
let pollInterval = null;
let discoveryInterval = null;
let lastMessagesHash = "";
let lastDiscoveryHash = "";
let isFetching = false;
let isSending = false;
let profileAvatarBase64 = "";

window.addEventListener("DOMContentLoaded", () => {
  bindShortcuts();
  if (currentUser?.id) showApp();
  else showAuth();
});

function safeJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; }
  catch { return fallback; }
}

function byId(id) { return document.getElementById(id); }

function showAuth() {
  byId("authScreen").classList.add("active");
  byId("appScreen").classList.remove("active");
  stopPolling();
}

function showApp() {
  if (!currentUser) return showAuth();

  byId("authScreen").classList.remove("active");
  byId("appScreen").classList.add("active");

  byId("myUsername").textContent = currentUser.username || "User";
  byId("myId").textContent = currentUser.id || "—";
  byId("modalMyId").textContent = currentUser.id || "—";
  setAvatar(byId("myAvatar"), currentUser.avatar);
  setAvatar(byId("editAvatarPreview"), currentUser.avatar);

  renderFriendsList();
  startDiscovery();
}

async function apiRequest(payload, options = {}) {
  const method = options.method || (payload ? "POST" : "GET");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 15000);

  try {
    const request = { method, signal: controller.signal };
    if (method === "POST") {
      request.body = JSON.stringify(payload);
    }
    const res = await fetch(
      method === "GET" ? buildGetUrl(options.params) : API_URL,
      request
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("استجابة غير صالحة من الخادم"); }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function buildGetUrl(params = {}) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  return url.toString();
}

async function login() {
  const u = byId("loginUsername").value.trim();
  const p = byId("loginPassword").value;
  const err = byId("authError");
  const btn = byId("loginBtn");

  if (!u || !p) {
    err.textContent = "اكتب اسم المستخدم وكلمة السر.";
    return;
  }

  btn.disabled = true;
  err.textContent = "جاري الاتصال…";

  try {
    const data = await apiRequest({
      action: "register_or_login",
      username: u,
      password: p
    });

    if (data.status === "success" && data.user?.id) {
      currentUser = data.user;
      localStorage.setItem("nn_user", JSON.stringify(currentUser));
      err.textContent = "";
      showApp();
      toast("تم تسجيل الدخول");
    } else {
      err.textContent = data.message || "تعذر تسجيل الدخول.";
    }
  } catch (error) {
    console.error(error);
    err.textContent = error.name === "AbortError"
      ? "انتهت مهلة الاتصال."
      : "تعذر الاتصال بالسيرفر.";
  } finally {
    btn.disabled = false;
  }
}

async function addFriend() {
  const input = byId("friendIdInput");
  const friendId = input.value.trim();

  if (!friendId) return input.focus();
  if (!currentUser?.id) return;

  if (friendId.toUpperCase() === String(currentUser.id).toUpperCase()) {
    toast("لا يمكنك فتح محادثة مع نفسك.");
    return;
  }

  input.disabled = true;

  try {
    const data = await apiRequest({
      action: "find_friend",
      friendId
    });

    if (data.status !== "success" || !data.friend?.id) {
      toast(data.message || "لم يتم العثور على هذا الـ ID.");
      return;
    }

    upsertFriend(data.friend);
    input.value = "";
    openChat(data.friend);
  } catch (error) {
    console.error(error);
    toast("تعذر العثور على الحساب.");
  } finally {
    input.disabled = false;
  }
}

function upsertFriend(friend) {
  if (!friend?.id || friend.id === currentUser?.id) return;

  const index = friends.findIndex(f => f.id === friend.id);
  if (index === -1) friends.unshift(friend);
  else friends[index] = { ...friends[index], ...friend };

  saveFriends();
  renderFriendsList();
}

function saveFriends() {
  localStorage.setItem("nn_friends", JSON.stringify(friends));
}

function renderFriendsList() {
  const container = byId("friendsList");
  const empty = byId("friendsEmpty");

  container.innerHTML = "";
  empty.hidden = friends.length > 0;

  for (const friend of friends) {
    const div = document.createElement("button");
    div.type = "button";
    div.className = `friend-item ${currentChatFriend?.id === friend.id ? "active" : ""}`;
    div.onclick = () => openChat(friend);

    const img = document.createElement("img");
    setAvatar(img, friend.avatar);
    img.alt = `صورة ${friend.username || ""}`;

    const main = document.createElement("span");
    main.className = "friend-main";

    const name = document.createElement("strong");
    name.textContent = friend.username || friend.id;

    const meta = document.createElement("span");
    meta.className = "friend-meta";

    const preview = document.createElement("span");
    preview.className = "friend-preview";
    preview.textContent = friend.lastMessage || friend.id;

    meta.appendChild(preview);
    main.append(name, meta);

    div.append(img, main);
    if (friend.unread) {
      const dot = document.createElement("span");
      dot.className = "unread-dot";
      div.appendChild(dot);
    }

    container.appendChild(div);
  }
}

function openChat(friend) {
  if (!friend?.id) return;

  currentChatFriend = friend;
  friend.unread = false;
  upsertFriend(friend);

  byId("noChatSelected").hidden = true;
  byId("activeChat").hidden = false;
  byId("appScreen").classList.add("chat-open");

  byId("chatFriendName").textContent = friend.username || friend.id;
  byId("chatFriendId").textContent = friend.id;
  setAvatar(byId("chatFriendAvatar"), friend.avatar);

  byId("chatStatus").textContent = "جاري المزامنة…";
  lastMessagesHash = "";
  fetchMessages(true);

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => fetchMessages(false), POLL_MS);
}

function closeChat() {
  currentChatFriend = null;
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
  byId("appScreen").classList.remove("chat-open");
  byId("activeChat").hidden = true;
  byId("noChatSelected").hidden = false;
  renderFriendsList();
}

function stopPolling() {
  if (pollInterval) clearInterval(pollInterval);
  if (discoveryInterval) clearInterval(discoveryInterval);
  pollInterval = null;
  discoveryInterval = null;
}

async function fetchMessages(isInitial = false) {
  if (!currentUser?.id || !currentChatFriend?.id || isFetching) return;

  isFetching = true;
  try {
    const data = await apiRequest(null, {
      method: "GET",
      params: {
        action: "get_messages",
        userId: currentUser.id,
        friendId: currentChatFriend.id
      },
      timeout: 9000
    });

    if (data.status !== "success" || !Array.isArray(data.messages)) {
      byId("chatStatus").textContent = "تعذر التحديث";
      return;
    }

    const hash = quickHash(data.messages);
    const changed = hash !== lastMessagesHash;

    if (changed || isInitial) {
      renderMessages(data.messages);
      lastMessagesHash = hash;
    }

    const last = data.messages[data.messages.length - 1];
    const friend = friends.find(f => f.id === currentChatFriend.id);
    if (friend && last) {
      friend.lastMessage = last.text || (last.attachment ? "📷 صورة" : "");
      saveFriends();
      renderFriendsList();
    }

    byId("chatStatus").textContent = "مزامنة سريعة";
    byId("lastSync").textContent = new Date().toLocaleTimeString("ar-MA", { hour:"2-digit", minute:"2-digit" });
    byId("syncState").textContent = "متصل";
  } catch (error) {
    console.error("get_messages", error);
    byId("chatStatus").textContent = "إعادة المحاولة…";
  } finally {
    isFetching = false;
  }
}

function renderMessages(messages) {
  const container = byId("messagesContainer");
  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  const fragment = document.createDocumentFragment();

  messages.forEach((m, index) => {
    const isMe = String(m.senderId) === String(currentUser.id);
    const msg = document.createElement("article");
    msg.className = `msg ${isMe ? "sent" : "received"}`;
    if (m.pending) msg.classList.add("pending");
    if (m.failed) msg.classList.add("failed");

    const copy = document.createElement("div");
    copy.className = "msg-copy";
    copy.textContent = m.text || "";
    msg.appendChild(copy);

    if (m.attachment) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "صورة مرفقة";
      img.src = m.attachment;
      msg.appendChild(img);
    }

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = formatMessageTime(m.timestamp || m.createdAt);
    msg.appendChild(meta);

    fragment.appendChild(msg);

    if (!isMe && index === messages.length - 1) {
      currentChatFriend.unread = false;
    }
  });

  container.replaceChildren(fragment);
  if (wasNearBottom || messages.length === 0) {
    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }
}

async function sendMsg() {
  if (isSending || !currentChatFriend || !currentUser) return;

  const input = byId("messageInput");
  const text = input.value.trim();
  if (!text && !selectedImageBase64) return;

  const btn = byId("sendBtn");
  const payload = {
    action: "send_message",
    senderId: currentUser.id,
    receiverId: currentChatFriend.id,
    text,
    attachment: selectedImageBase64
  };

  isSending = true;
  btn.disabled = true;
  btn.innerHTML = "<span>...</span>";

  const previewMessage = {
    senderId: currentUser.id,
    text,
    attachment: selectedImageBase64,
    timestamp: new Date().toISOString(),
    pending: true
  };

  // Optimistic UI: تظهر الرسالة فورًا للمُرسل ثم يؤكدها السيرفر.
  appendOptimisticMessage(previewMessage);

  input.value = "";
  clearSelectedImage(false);

  try {
    const data = await apiRequest(payload, { method: "POST", timeout: 20000 });
    if (data.status && data.status !== "success") {
      toast(data.message || "تعذر إرسال الرسالة.");
    }
    await fetchMessages();
  } catch (error) {
    console.error("send_message", error);
    toast(error.name === "AbortError" ? "استغرق الإرسال وقتًا أطول من المتوقع." : "تعذر إرسال الرسالة.");
  } finally {
    isSending = false;
    btn.disabled = false;
    btn.innerHTML = "<span>إرسال</span><span>↗</span>";
    input.focus();
  }
}

function appendOptimisticMessage(message) {
  const container = byId("messagesContainer");
  const msg = document.createElement("article");
  msg.className = "msg sent pending";

  const copy = document.createElement("div");
  copy.className = "msg-copy";
  copy.textContent = message.text || "";
  msg.appendChild(copy);

  if (message.attachment) {
    const img = document.createElement("img");
    img.src = message.attachment;
    img.alt = "الصورة المرفقة";
    msg.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.textContent = "جاري الإرسال…";
  msg.appendChild(meta);

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

async function handleImageSelect(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    toast("اختر ملف صورة فقط.");
    return;
  }

  try {
    const result = await prepareImage(file, 1280, .80);
    selectedImageBase64 = result.dataUrl;

    const previewBar = byId("imagePreviewBar");
    const preview = byId("imagePreview");
    const name = byId("imageName");
    const size = byId("imageSize");

    preview.src = selectedImageBase64;
    name.textContent = file.name;
    size.textContent = `${formatBytes(file.size)} → ${formatBytes(result.blob.size)} · JPEG مضغوط`;
    previewBar.hidden = false;
  } catch (error) {
    console.error(error);
    toast("تعذر معالجة الصورة.");
  }
}

async function prepareImage(file, maxSide, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let q = quality;
  let blob = await canvasToBlob(canvas, "image/jpeg", q);

  while (blob.size > MAX_IMAGE_BYTES && q > .55) {
    q -= .05;
    blob = await canvasToBlob(canvas, "image/jpeg", q);
  }

  // Fallback for very large images.
  if (blob.size > MAX_IMAGE_BYTES) {
    const reduced = await prepareImage(file, 960, .65);
    return reduced;
  }

  return { blob, dataUrl: await blobToDataUrl(blob) };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Canvas export failed")), type, quality);
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function clearSelectedImage(resetInput = true) {
  selectedImageBase64 = "";
  if (resetInput) byId("imageInput").value = "";
  byId("imagePreviewBar").hidden = true;
  byId("imagePreview").removeAttribute("src");
}

function openProfileModal() {
  byId("profileModal").classList.add("active");
  byId("modalMyId").textContent = currentUser.id;
  byId("editUsernameInput").value = currentUser.username || "";
  setAvatar(byId("editAvatarPreview"), currentUser.avatar);
  profileAvatarBase64 = "";
  byId("profileStatus").textContent = "";
}

function closeProfileModal() {
  byId("profileModal").classList.remove("active");
}

async function previewNewAvatar(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  try {
    const result = await prepareImage(file, 512, .82);
    profileAvatarBase64 = result.dataUrl;
    byId("editAvatarPreview").src = profileAvatarBase64;
    byId("profileStatus").textContent = "الصورة جاهزة للحفظ.";
  } catch (error) {
    console.error(error);
    byId("profileStatus").textContent = "تعذر تجهيز الصورة.";
  }
}

async function saveProfileChanges() {
  const newUsername = byId("editUsernameInput").value.trim();
  const newAvatar = profileAvatarBase64 || currentUser.avatar || "";

  if (!newUsername) {
    byId("profileStatus").textContent = "الاسم لا يمكن أن يكون فارغًا.";
    return;
  }

  const btn = byId("saveProfileBtn");
  btn.disabled = true;
  byId("profileStatus").textContent = "جاري الحفظ…";

  try {
    const data = await apiRequest({
      action: "update_profile",
      userId: currentUser.id,
      username: newUsername,
      avatar: newAvatar
    });

    if (data.status && data.status !== "success") {
      byId("profileStatus").textContent = data.message || "تعذر حفظ التغييرات.";
      return;
    }

    // Use server-returned user when available so we don't overwrite generated fields.
    currentUser = {
      ...currentUser,
      ...(data.user || {}),
      username: data.user?.username || newUsername,
      avatar: data.user?.avatar || newAvatar
    };

    localStorage.setItem("nn_user", JSON.stringify(currentUser));

    // Update local conversation metadata too.
    friends = friends.map(f => f.id === currentUser.id ? currentUser : f);
    saveFriends();

    showApp();
    closeProfileModal();
    toast("تم حفظ الحساب");
  } catch (error) {
    console.error(error);
    byId("profileStatus").textContent = "تعذر الاتصال بالخادم.";
  } finally {
    btn.disabled = false;
  }
}

/* Discovery
   One-sided ID sharing requires the backend to expose conversations addressed
   to the current user. We intentionally try both common action names, without
   breaking older deployments that don't implement either one.
*/
function startDiscovery() {
  if (discoveryInterval) clearInterval(discoveryInterval);
  syncIncomingConversations();
  discoveryInterval = setInterval(syncIncomingConversations, DISCOVERY_MS);
}

async function syncIncomingConversations() {
  if (!currentUser?.id) return;

  const actions = ["get_conversations", "get_inbox"];
  let discovered = [];

  for (const action of actions) {
    try {
      const data = await apiRequest(null, {
        method: "GET",
        params: { action, userId: currentUser.id },
        timeout: 7000
      });

      if (data.status === "success") {
        discovered = normalizeConversationList(data);
        if (discovered.length) break;
      }
    } catch (error) {
      // Optional endpoint — old backend may not have it.
    }
  }

  if (!discovered.length) return;

  const hash = quickHash(discovered);
  if (hash === lastDiscoveryHash) return;
  lastDiscoveryHash = hash;

  discovered.forEach(item => {
    const existing = friends.find(f => f.id === item.id);
    if (!existing) {
      item.unread = true;
      upsertFriend(item);
      toast(`رسالة جديدة من ${item.username || item.id}`);
    } else {
      const merged = { ...existing, ...item };
      if (item.lastMessage && String(item.lastSenderId) !== String(currentUser.id)) {
        merged.unread = currentChatFriend?.id !== item.id;
      }
      upsertFriend(merged);
    }
  });

  if (currentChatFriend) {
    const refreshed = friends.find(f => f.id === currentChatFriend.id);
    if (refreshed) currentChatFriend = refreshed;
  }
}

function normalizeConversationList(data) {
  const list = data.conversations || data.inbox || data.users || data.friends || [];
  if (!Array.isArray(list)) return [];

  return list.map(item => {
    const user = item.friend || item.sender || item.user || item;
    return {
      id: user.id,
      username: user.username || user.name || user.id,
      avatar: user.avatar || "",
      lastMessage: item.lastMessage || item.text || "",
      lastSenderId: item.lastSenderId || item.senderId || "",
      unread: Boolean(item.unread)
    };
  }).filter(item => item.id && item.id !== currentUser.id);
}

function copyMyId() {
  copyText(currentUser.id, "تم نسخ الـ ID الخاص بك");
}

function copyFriendId() {
  if (currentChatFriend?.id) copyText(currentChatFriend.id, "تم نسخ ID المحادثة");
}

async function copyText(text, message) {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(message);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = String(text);
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast(message);
  }
}

function setAvatar(img, src) {
  img.src = src || makeFallbackAvatar("N");
}

function makeFallbackAvatar(letter) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="30" fill="#17202a"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="52" fill="#d8ff58">${escapeXml(letter)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function bindShortcuts() {
  byId("friendIdInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFriend();
    }
  });

  byId("messageInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });

  window.addEventListener("beforeunload", stopPolling);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && byId("profileModal").classList.contains("active")) {
      closeProfileModal();
    }
  });
}

function formatMessageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ar-MA", { hour:"2-digit", minute:"2-digit" });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function quickHash(value) {
  const str = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return String(hash >>> 0);
}

function escapeXml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function toast(message) {
  const el = byId("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove("show"), 2200);
}
