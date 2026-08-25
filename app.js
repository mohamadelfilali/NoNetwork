// ضع رابط الـ Web App الخاص بك من Google Apps Script هنا
const API_URL = "https://script.google.com/macros/s/AKfycbxsJaY5cNNWe2sgzKZURjx5aIC_Ku2cJCS49a5CZiFNQfYtYasERTCs4WMCDoV3porPZQ/exec";

let currentUser = JSON.parse(localStorage.getItem("nn_user")) || null;
let currentChatFriend = null;
let friends = JSON.parse(localStorage.getItem("nn_friends")) || [];
let selectedImageBase64 = "";
let pollInterval = null;

// التهيئة عند التحميل
window.onload = () => {
  if (currentUser) {
    showApp();
  } else {
    showAuth();
  }
};

function showAuth() {
  document.getElementById("authScreen").classList.add("active");
  document.getElementById("appScreen").classList.remove("active");
}

function showApp() {
  document.getElementById("authScreen").classList.remove("active");
  document.getElementById("appScreen").classList.add("active");

  document.getElementById("myUsername").innerText = currentUser.username;
  document.getElementById("myId").innerText = currentUser.id;
  document.getElementById("myAvatar").src = currentUser.avatar;

  renderFriendsList();
}

async function login() {
  const u = document.getElementById("loginUsername").value.trim();
  const p = document.getElementById("loginPassword").value.trim();
  const err = document.getElementById("authError");

  if (!u || !p) {
    err.innerText = "يرجى ملء كافة الحقول";
    return;
  }

  err.innerText = "جاري الاتصال...";

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "register_or_login", username: u, password: p })
    });
    const data = await res.json();

    if (data.status === "success") {
      currentUser = data.user;
      localStorage.setItem("nn_user", JSON.stringify(currentUser));
      err.innerText = "";
      showApp();
    } else {
      err.innerText = data.message;
    }
  } catch (e) {
    err.innerText = "خطأ في الاتصال بالسيرفر";
  }
}

async function addFriend() {
  const friendId = document.getElementById("friendIdInput").value.trim();
  if (!friendId) return;

  if (friendId === currentUser.id) {
    alert("لا يمكنك إضافة نفسك!");
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "find_friend", friendId: friendId })
    });
    const data = await res.json();

    if (data.status === "success") {
      const exists = friends.some(f => f.id === data.friend.id);
      if (!exists) {
        friends.push(data.friend);
        localStorage.setItem("nn_friends", JSON.stringify(friends));
        renderFriendsList();
      }
      openChat(data.friend);
      document.getElementById("friendIdInput").value = "";
    } else {
      alert(data.message);
    }
  } catch (e) {
    alert("خطأ أثناء جلب حساب الصديق");
  }
}

function renderFriendsList() {
  const container = document.getElementById("friendsList");
  container.innerHTML = "";

  friends.forEach(f => {
    const div = document.createElement("div");
    div.className = `friend-item ${currentChatFriend?.id === f.id ? "active" : ""}`;
    div.onclick = () => openChat(f);
    div.innerHTML = `
      <img src="${f.avatar}" alt="avatar">
      <div>
        <h4>${escapeHtml(f.username)}</h4>
        <span class="badge">${f.id}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

function openChat(friend) {
  currentChatFriend = friend;
  renderFriendsList();

  document.getElementById("noChatSelected").style.display = "none";
  document.getElementById("activeChat").style.display = "flex";

  document.getElementById("chatFriendName").innerText = friend.username;
  document.getElementById("chatFriendId").innerText = friend.id;
  document.getElementById("chatFriendAvatar").src = friend.avatar;

  fetchMessages();

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(fetchMessages, 3000);
}

async function fetchMessages() {
  if (!currentChatFriend) return;

  try {
    const res = await fetch(`${API_URL}?action=get_messages&userId=${currentUser.id}&friendId=${currentChatFriend.id}`);
    const data = await res.json();

    if (data.status === "success") {
      const container = document.getElementById("messagesContainer");
      container.innerHTML = "";

      data.messages.forEach(m => {
        const isMe = m.senderId === currentUser.id;
        const msgDiv = document.createElement("div");
        msgDiv.className = `msg ${isMe ? "sent" : "received"}`;

        let imgHtml = m.attachment ? `<img src="${m.attachment}" alt="صورة">` : "";
        msgDiv.innerHTML = `<div>${escapeHtml(m.text)}</div>${imgHtml}`;

        container.appendChild(msgDiv);
      });

      container.scrollTop = container.scrollHeight;
    }
  } catch (e) {
    console.error("خطأ في تحديث الرسائل", e);
  }
}

async function sendMsg() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();

  if (!text && !selectedImageBase64) return;

  const btn = document.getElementById("sendBtn");
  btn.disabled = true;

  try {
    await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "send_message",
        senderId: currentUser.id,
        receiverId: currentChatFriend.id,
        text: text,
        attachment: selectedImageBase64
      })
    });

    input.value = "";
    selectedImageBase64 = "";
    fetchMessages();
  } catch (e) {
    alert("تعذر إرسال الرسالة");
  } finally {
    btn.disabled = false;
  }
}

function handleImageSelect() {
  const file = document.getElementById("imageInput").files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    selectedImageBase64 = reader.result;
    alert("تم اختيار الصورة بنجاح، اضغط إرسال");
  };
  reader.readAsDataURL(file);
}

// تعديل الملف الشخصي
function openProfileModal() {
  document.getElementById("profileModal").classList.add("active");
  document.getElementById("modalMyId").innerText = currentUser.id;
  document.getElementById("editUsernameInput").value = currentUser.username;
  document.getElementById("editAvatarPreview").src = currentUser.avatar;
}

function closeProfileModal() {
  document.getElementById("profileModal").classList.remove("active");
}

function previewNewAvatar() {
  const file = document.getElementById("avatarFileInput").files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById("editAvatarPreview").src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function saveProfileChanges() {
  const newUsername = document.getElementById("editUsernameInput").value.trim();
  const newAvatar = document.getElementById("editAvatarPreview").src;

  if (!newUsername) return;

  try {
    await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "update_profile",
        userId: currentUser.id,
        username: newUsername,
        avatar: newAvatar
      })
    });

    currentUser.username = newUsername;
    currentUser.avatar = newAvatar;
    localStorage.setItem("nn_user", JSON.stringify(currentUser));

    showApp();
    closeProfileModal();
  } catch (e) {
    alert("خطأ أثناء تعديل الملف الشخصي");
  }
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
