/**
 * DiffuseChat — Frontend Application
 * Connects the premium chat UI with the Stable Diffusion Flask backend.
 */

// ═══════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════
const API_BASE = window.location.origin; // same-origin — Flask serves both
const STORAGE_KEY = "diffusechat_chats_v1";

// ═══════════════════════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════════════════════
const state = {
  chats: {},          // { [chatId]: { id, title, created_at, messages } }
  activeChatId: null,
  generating: false,
  sidebarOpen: false, // mobile default
};

// ═══════════════════════════════════════════════════════════════════
//  DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════
const $sidebar        = document.getElementById("sidebar");
const $sidebarOverlay = document.getElementById("sidebarOverlay");
const $sidebarClose   = document.getElementById("sidebarClose");
const $sidebarToggle  = document.getElementById("sidebarToggle");
const $newChatBtn     = document.getElementById("newChatBtn");
const $chatList       = document.getElementById("chatList");
const $chatListEmpty  = document.getElementById("chatListEmpty");
const $topbarTitle    = document.getElementById("topbarTitle");
const $settingsToggle = document.getElementById("settingsToggle");
const $settingsPanel  = document.getElementById("settingsPanel");
const $welcomeScreen  = document.getElementById("welcomeScreen");
const $messagesArea   = document.getElementById("messagesArea");
const $chatViewport   = document.getElementById("chatViewport");
const $promptInput    = document.getElementById("promptInput");
const $sendBtn        = document.getElementById("sendBtn");
const $statusDot      = document.getElementById("statusDot");
const $statusText     = document.getElementById("statusText");
const $lightbox       = document.getElementById("lightbox");
const $lightboxImg    = document.getElementById("lightboxImg");
const $lightboxClose  = document.getElementById("lightboxClose");
const $lightboxBackdrop = document.getElementById("lightboxBackdrop");
const $lightboxDownload = document.getElementById("lightboxDownload");

// Settings inputs
const $negPrompt  = document.getElementById("negPrompt");
const $imgWidth   = document.getElementById("imgWidth");
const $imgHeight  = document.getElementById("imgHeight");
const $stepsRange = document.getElementById("stepsRange");
const $stepsVal   = document.getElementById("stepsVal");
const $cfgRange   = document.getElementById("cfgRange");
const $cfgVal     = document.getElementById("cfgVal");
const $seedInput  = document.getElementById("seedInput");

// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (d.toDateString() === now.toDateString()) return formatTime(isoString);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// Progress bar
let progressEl = null;
function showProgress(pct) {
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.className = "progress-bar";
    document.body.appendChild(progressEl);
  }
  progressEl.style.width = pct + "%";
}
function hideProgress() {
  if (progressEl) { progressEl.style.width = "0%"; setTimeout(() => progressEl?.remove(), 400); progressEl = null; }
}

// ═══════════════════════════════════════════════════════════════════
//  LOCAL PERSISTENCE (fallback when backend is offline)
// ═══════════════════════════════════════════════════════════════════
function saveLocal() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.chats)); } catch (_) {}
}

function loadLocal() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) state.chats = JSON.parse(raw);
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════════════
//  API CALLS
// ═══════════════════════════════════════════════════════════════════
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(API_BASE + path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro desconhecido");
    return data;
  } catch (err) {
    throw err;
  }
}

async function checkModelStatus() {
  try {
    const data = await apiFetch("/api/status");
    $statusDot.className = "status-dot " + (data.model_loaded ? "online" : "offline");
    $statusText.textContent = data.model_loaded
      ? `Modelo ativo${data.cuda_available ? " (GPU)" : " (CPU)"}`
      : "Modelo não carregado";
  } catch {
    $statusDot.className = "status-dot offline";
    $statusText.textContent = "Servidor offline";
  }
}

async function syncChatsFromServer() {
  try {
    const data = await apiFetch("/api/chats");
    // Merge server chats into local state (server is source of truth)
    for (const c of data.chats) {
      if (!state.chats[c.id] || !state.chats[c.id].messages) {
        state.chats[c.id] = { ...c, messages: state.chats[c.id]?.messages || [] };
      }
    }
    renderChatList();
  } catch {
    // Offline mode — use local state
    loadLocal();
    renderChatList();
  }
}

async function createChatOnServer(chatId, title) {
  try {
    await apiFetch("/api/chats", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  } catch (_) {}
}

async function deleteChatOnServer(chatId) {
  try { await apiFetch(`/api/chats/${chatId}`, { method: "DELETE" }); } catch (_) {}
}

async function generateImage(chatId, prompt) {
  const params = {
    chat_id:         chatId,
    prompt:          prompt,
    negative_prompt: $negPrompt.value.trim(),
    width:           parseInt($imgWidth.value),
    height:          parseInt($imgHeight.value),
    steps:           parseInt($stepsRange.value),
    guidance_scale:  parseFloat($cfgRange.value),
    seed:            parseInt($seedInput.value),
  };

  const data = await apiFetch("/api/generate", {
    method: "POST",
    body: JSON.stringify(params),
  });

  return data; // { message, user_msg, chat_id }
}

// ═══════════════════════════════════════════════════════════════════
//  CHAT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════
function createLocalChat(title = "Nova Conversa") {
  const id = uuid();
  state.chats[id] = {
    id,
    title,
    created_at: new Date().toISOString(),
    messages: [],
  };
  createChatOnServer(id, title);
  saveLocal();
  return id;
}

function setActiveChat(chatId) {
  state.activeChatId = chatId;
  renderChatList();
  renderMessages();
  const chat = state.chats[chatId];
  $topbarTitle.textContent = chat?.title || "DiffuseChat";
  // Fetch full messages from server if needed
  fetchChatMessages(chatId);
}

async function fetchChatMessages(chatId) {
  try {
    const data = await apiFetch(`/api/chats/${chatId}`);
    if (data.chat && data.chat.messages) {
      state.chats[chatId] = data.chat;
      renderMessages();
    }
  } catch (_) {}
}

function deleteChat(chatId, e) {
  e.stopPropagation();
  delete state.chats[chatId];
  deleteChatOnServer(chatId);
  saveLocal();
  if (state.activeChatId === chatId) {
    state.activeChatId = null;
    renderMessages();
    $topbarTitle.textContent = "DiffuseChat";
  }
  renderChatList();
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER — CHAT LIST
// ═══════════════════════════════════════════════════════════════════
function renderChatList() {
  const chats = Object.values(state.chats).sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  // Clear
  Array.from($chatList.querySelectorAll(".chat-item")).forEach(el => el.remove());
  $chatListEmpty.classList.toggle("hidden", chats.length > 0);

  for (const chat of chats) {
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === state.activeChatId ? " active" : "");
    item.dataset.chatId = chat.id;
    item.innerHTML = `
      <span class="chat-item-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>
      </span>
      <div class="chat-item-body">
        <div class="chat-item-title">${escapeHtml(chat.title)}</div>
        <div class="chat-item-date">${formatDate(chat.created_at)}</div>
      </div>
      <button class="chat-item-delete" title="Excluir conversa" aria-label="Excluir">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    `;
    item.querySelector(".chat-item-delete").addEventListener("click", (e) => deleteChat(chat.id, e));
    item.addEventListener("click", () => {
      setActiveChat(chat.id);
      if (window.innerWidth <= 768) closeSidebar();
    });
    $chatList.appendChild(item);
  }
}

// ═══════════════════════════════════════════════════════════════════
//  RENDER — MESSAGES
// ═══════════════════════════════════════════════════════════════════
function renderMessages() {
  const chat = state.activeChatId ? state.chats[state.activeChatId] : null;

  // Welcome screen visibility
  const hasMessages = chat && chat.messages && chat.messages.length > 0;
  $welcomeScreen.classList.toggle("hidden", !!chat);
  $messagesArea.innerHTML = "";

  if (!chat) return;

  for (const msg of chat.messages) {
    $messagesArea.appendChild(buildMessageEl(msg));
  }

  scrollToBottom();
}

function buildMessageEl(msg) {
  const group = document.createElement("div");
  group.className = `message-group ${msg.role}`;
  group.dataset.msgId = msg.id;

  const avatarText = msg.role === "user" ? "U" : "AI";
  const avatarSvg  = msg.role === "assistant"
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
         <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
         <path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
       </svg>`
    : avatarText;

  let bubbleContent = "";

  if (msg.type === "text") {
    bubbleContent = `<div class="bubble-text">${escapeHtml(msg.content)}</div>`;
  } else if (msg.type === "image") {
    const imgSrc = `data:image/png;base64,${msg.image_b64}`;
    bubbleContent = `
      <div class="bubble-image-wrapper" data-src="${imgSrc}" data-prompt="${escapeHtml(msg.prompt)}">
        <img class="bubble-image" src="${imgSrc}" alt="Imagem gerada: ${escapeHtml(msg.prompt)}" loading="lazy" />
        <div class="bubble-image-overlay">
          <button class="img-action-btn" data-action="download" data-src="${imgSrc}" data-prompt="${escapeHtml(msg.prompt)}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Baixar
          </button>
          <button class="img-action-btn" data-action="expand" data-src="${imgSrc}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Ampliar
          </button>
        </div>
      </div>
      <div class="bubble-caption">"${escapeHtml(msg.prompt)}"</div>
      ${msg.status ? `<div class="bubble-warning">${escapeHtml(msg.status)}</div>` : ""}
    `;
  }

  const timestamp = `<div class="msg-timestamp">${formatTime(msg.created_at)}</div>`;

  group.innerHTML = `
    <div class="msg-avatar">${avatarSvg}</div>
    <div class="msg-bubble">
      ${bubbleContent}
      ${timestamp}
    </div>
  `;

  // Bind image actions
  group.querySelectorAll(".img-action-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.dataset.action === "download") downloadImage(btn.dataset.src, btn.dataset.prompt);
      if (btn.dataset.action === "expand")   openLightbox(btn.dataset.src);
    });
  });
  group.querySelectorAll(".bubble-image-wrapper").forEach(wrapper => {
    wrapper.addEventListener("click", () => openLightbox(wrapper.dataset.src));
  });

  return group;
}

function appendMessage(msg) {
  const el = buildMessageEl(msg);
  $messagesArea.appendChild(el);
  scrollToBottom();
}

function showTypingIndicator() {
  const group = document.createElement("div");
  group.className = "message-group assistant";
  group.id = "typingIndicator";
  group.innerHTML = `
    <div class="msg-avatar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M2 17l10 5 10-5" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <span class="typing-label">Gerando imagem…</span>
      </div>
    </div>
  `;
  $messagesArea.appendChild(group);
  scrollToBottom();
}

function removeTypingIndicator() {
  document.getElementById("typingIndicator")?.remove();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    $chatViewport.scrollTop = $chatViewport.scrollHeight;
  });
}

// ═══════════════════════════════════════════════════════════════════
//  SEND MESSAGE FLOW
// ═══════════════════════════════════════════════════════════════════
async function sendMessage() {
  const prompt = $promptInput.value.trim();
  if (!prompt || state.generating) return;

  // Ensure active chat
  if (!state.activeChatId) {
    const id = createLocalChat(prompt.slice(0, 50));
    state.activeChatId = id;
    renderChatList();
    $topbarTitle.textContent = state.chats[id].title;
    $welcomeScreen.classList.add("hidden");
  }

  const chatId = state.activeChatId;

  // Add user message locally for immediate feedback
  const userMsg = {
    id: uuid(),
    role: "user",
    type: "text",
    content: prompt,
    created_at: new Date().toISOString(),
  };
  state.chats[chatId].messages.push(userMsg);
  saveLocal();
  appendMessage(userMsg);

  // Clear input
  $promptInput.value = "";
  autoResizeTextarea($promptInput);
  $sendBtn.disabled = true;
  state.generating = true;

  // Show typing
  showTypingIndicator();
  showProgress(15);

  try {
    // Simulated progress ticks
    const progressInterval = setInterval(() => {
      const currentW = parseFloat(progressEl?.style.width || 15);
      if (currentW < 85) showProgress(currentW + Math.random() * 6);
    }, 800);

    const result = await generateImage(chatId, prompt);

    clearInterval(progressInterval);
    showProgress(100);

    removeTypingIndicator();

    // Merge server response
    if (result.message) {
      state.chats[chatId].messages.push(result.message);
      // Update title if server renamed it
      if (result.message) {
        const serverTitle = await apiFetch(`/api/chats/${chatId}`)
          .then(d => d.chat.title).catch(() => null);
        if (serverTitle) {
          state.chats[chatId].title = serverTitle;
          $topbarTitle.textContent = serverTitle;
          renderChatList();
        }
      }
      saveLocal();
      appendMessage(result.message);
    }

  } catch (err) {
    removeTypingIndicator();
    // Show error as assistant message
    const errMsg = {
      id: uuid(),
      role: "assistant",
      type: "text",
      content: `❌ Erro ao gerar imagem: ${err.message}`,
      created_at: new Date().toISOString(),
    };
    state.chats[chatId].messages.push(errMsg);
    saveLocal();
    appendMessage(errMsg);
  } finally {
    hideProgress();
    state.generating = false;
    $sendBtn.disabled = $promptInput.value.trim().length === 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════════════════
function openSidebar() {
  $sidebar.classList.add("open");
  $sidebarOverlay.classList.add("visible");
  state.sidebarOpen = true;
}

function closeSidebar() {
  $sidebar.classList.remove("open");
  $sidebarOverlay.classList.remove("visible");
  state.sidebarOpen = false;
}

function toggleSidebar() {
  if (window.innerWidth <= 768) {
    state.sidebarOpen ? closeSidebar() : openSidebar();
  } else {
    // Desktop: just toggle width via class
    $sidebar.classList.toggle("collapsed");
    document.querySelector(".main").classList.toggle("sidebar-collapsed");
  }
}

// ═══════════════════════════════════════════════════════════════════
//  LIGHTBOX
// ═══════════════════════════════════════════════════════════════════
let lightboxSrc = "";

function openLightbox(src) {
  lightboxSrc = src;
  $lightboxImg.src = src;
  $lightbox.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  $lightbox.classList.remove("open");
  document.body.style.overflow = "";
  setTimeout(() => { $lightboxImg.src = ""; }, 300);
}

// ═══════════════════════════════════════════════════════════════════
//  DOWNLOAD
// ═══════════════════════════════════════════════════════════════════
function downloadImage(src, prompt) {
  const a = document.createElement("a");
  a.href = src;
  const safePrompt = (prompt || "image").replace(/[^a-z0-9]/gi, "_").slice(0, 40);
  a.download = `diffusechat_${safePrompt}_${Date.now()}.png`;
  a.click();
}

// ═══════════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════

// Sidebar toggle
$sidebarToggle.addEventListener("click", toggleSidebar);
$sidebarClose.addEventListener("click", closeSidebar);
$sidebarOverlay.addEventListener("click", closeSidebar);

// New chat
$newChatBtn.addEventListener("click", () => {
  const id = createLocalChat();
  setActiveChat(id);
  renderChatList();
  if (window.innerWidth <= 768) closeSidebar();
  $promptInput.focus();
});

// Settings toggle
$settingsToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  $settingsPanel.classList.toggle("open");
  $settingsToggle.classList.toggle("active");
});
document.addEventListener("click", (e) => {
  if (!$settingsPanel.contains(e.target) && e.target !== $settingsToggle) {
    $settingsPanel.classList.remove("open");
    $settingsToggle.classList.remove("active");
  }
});

// Slider live values
$stepsRange.addEventListener("input", () => { $stepsVal.textContent = $stepsRange.value; });
$cfgRange.addEventListener("input",   () => { $cfgVal.textContent   = $cfgRange.value;   }); 
