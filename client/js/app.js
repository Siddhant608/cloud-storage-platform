const authView = document.querySelector("#auth-view");
const signedInView = document.querySelector("#signed-in-view");

const authForm = document.querySelector("#auth-form");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const nameGroup = document.querySelector("#name-group");
const nameInput = document.querySelector("#full-name");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const formTitle = document.querySelector("#form-title");
const formEyebrow = document.querySelector("#form-eyebrow");
const formDescription = document.querySelector("#form-description");
const submitButton = document.querySelector("#submit-button");
const errorMessage = document.querySelector("#form-error");
const successMessage = document.querySelector("#form-success");
const switchPrompt = document.querySelector("#switch-prompt");
const switchModeButton = document.querySelector("#switch-mode");
const togglePasswordButton = document.querySelector("#toggle-password");
const connectionIndicator = document.querySelector("#connection-indicator");
const connectionMessage = document.querySelector("#connection-message");
const logoutButton = document.querySelector("#logout-button");

const pageTitle = document.querySelector("#page-title");
const pageSubtitle = document.querySelector("#page-subtitle");
const dashboardMessage = document.querySelector("#dashboard-message");
const fileInput = document.querySelector("#file-input");

let currentMode = "login";
let currentUser = null;
let allFiles = [];
let allFolders = [];
let currentFolderId = null;
let currentPage = "overview";

const pageInfo = {
  overview: ["Overview", "Your files and storage at a glance."],
  files: ["My files", "Browse and manage your stored files."],
  folders: ["Folders", "Organize your files into folders."],
  shared: ["Shared", "Files shared with your account."],
  activity: ["Activity", "Recent events in your workspace."]
};

function showMessage(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function clearMessages() {
  errorMessage.hidden = true;
  successMessage.hidden = true;
  errorMessage.textContent = "";
  successMessage.textContent = "";
}

function setMode(mode) {
  currentMode = mode;
  clearMessages();
  authForm.reset();

  const registering = mode === "register";
  nameGroup.hidden = !registering;
  nameInput.required = registering;
  passwordInput.autocomplete = registering ? "new-password" : "current-password";
  formEyebrow.textContent = registering ? "GET STARTED" : "WELCOME BACK";
  formTitle.textContent = registering ? "Create your account" : "Sign in to CloudVault";
  formDescription.textContent = registering
    ? "Create an account to get started with CloudVault."
    : "Enter your details to access your workspace.";
  submitButton.textContent = registering ? "Create account" : "Sign in";
  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);
  loginTab.setAttribute("aria-selected", String(!registering));
  registerTab.setAttribute("aria-selected", String(registering));
  switchPrompt.firstChild.textContent = registering
    ? "Already have an account? "
    : "Don't have an account? ";
  switchModeButton.textContent = registering ? "Sign in" : "Create one";
}

async function apiRequest(url, options = {}) {
  const headers = { ...options.headers };
  const isFormData = options.body instanceof FormData;

  if (options.body && !isFormData && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}

function showAuthenticationView() {
  signedInView.hidden = true;
  authView.hidden = false;
}

function showAuthenticatedView(user) {
  currentUser = user;
  authView.hidden = true;
  signedInView.hidden = false;

  const name = user.full_name || user.fullName || "CloudVault user";
  document.querySelector("#sidebar-user-name").textContent = name;
  document.querySelector("#sidebar-user-email").textContent = user.email || "";
  document.querySelector("#user-avatar").textContent = name.trim().charAt(0).toUpperCase();

  setPage("overview");
  loadDashboard();
}

async function checkConnection() {
  try {
    await apiRequest("/api/health");
    connectionIndicator.className = "status-dot online";
    connectionMessage.textContent = "Server and database connected";
  } catch {
    connectionIndicator.className = "status-dot offline";
    connectionMessage.textContent = "Unable to connect to server";
  }
}

async function checkExistingSession() {
  try {
    const data = await apiRequest("/api/auth/me");
    showAuthenticatedView(data.user);
  } catch {
    showAuthenticationView();
  }
}

async function handleAuthentication(event) {
  event.preventDefault();
  clearMessages();

  if (!authForm.reportValidity()) return;

  const payload = {
    email: emailInput.value.trim(),
    password: passwordInput.value
  };
  let endpoint = "/api/auth/login";

  if (currentMode === "register") {
    payload.fullName = nameInput.value.trim();
    endpoint = "/api/auth/register";

    if (payload.fullName.length < 2) {
      showMessage(errorMessage, "Full name must contain at least 2 characters.");
      return;
    }
    if (new TextEncoder().encode(payload.password).length > 72) {
      showMessage(errorMessage, "Password must not exceed 72 UTF-8 bytes.");
      return;
    }
    if (payload.password.length < 8) {
      showMessage(errorMessage, "Password must contain at least 8 characters.");
      return;
    }
  }

  submitButton.disabled = true;
  submitButton.textContent = "Please wait...";

  try {
    const data = await apiRequest(endpoint, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    showMessage(successMessage, data.message || "Success.");
    showAuthenticatedView(data.user);
  } catch (error) {
    showMessage(errorMessage, error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = currentMode === "register" ? "Create account" : "Sign in";
  }
}

async function handleLogout() {
  logoutButton.disabled = true;
  logoutButton.textContent = "Signing out...";
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
    currentUser = null;
    showAuthenticationView();
    setMode("login");
  } catch (error) {
    alert(error.message);
  } finally {
    logoutButton.disabled = false;
    logoutButton.textContent = "Sign out";
  }
}

function setPage(page) {
  currentPage = page;
  const [title, subtitle] = pageInfo[page] || pageInfo.overview;
  pageTitle.textContent = title;
  pageSubtitle.textContent = subtitle;

  document.querySelectorAll(".page-panel").forEach(panel => {
    panel.hidden = panel.id !== `${page}-page`;
  });
  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  const folderActions = page === "folders" || page === "overview";
  document.querySelector("#create-folder-button").hidden = !folderActions;
  document.querySelector("#upload-button").hidden = page === "activity";
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function showDashboardMessage(message, isError = false) {
  dashboardMessage.textContent = message;
  dashboardMessage.classList.toggle("is-error", isError);
  dashboardMessage.hidden = false;
  window.clearTimeout(showDashboardMessage.timer);
  showDashboardMessage.timer = window.setTimeout(() => {
    dashboardMessage.hidden = true;
  }, 4500);
}

function makeEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}


// ==========================================
// PUBLIC FILE SHARING
// ==========================================

function escapeShareHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function ensureShareDialog() {
  if (document.querySelector("#share-dialog")) return;

  const dialog = document.createElement("div");
  dialog.id = "share-dialog";
  dialog.className = "share-overlay";
  dialog.hidden = true;

  dialog.innerHTML = `
    <section class="share-modal" role="dialog" aria-modal="true"
      aria-labelledby="share-title">

      <div class="share-modal-header">
        <div>
          <span class="share-eyebrow">CLOUDVAULT SHARING</span>
          <h2 id="share-title">Share file</h2>
          <p id="share-file-name"></p>
        </div>
        <button type="button" class="share-close" id="share-close"
          aria-label="Close">&times;</button>
      </div>

      <div class="share-modal-body">
        <label for="share-permission">Access permission</label>
        <select id="share-permission">
          <option value="viewer" selected>Viewer - Can view and download</option>
          <option value="editor">Editor - Can upload new versions</option>
        </select>

        <label for="share-expiry">Link expiration</label>
        <select id="share-expiry">
          <option value="never">Never expires</option>
          <option value="1">1 day</option>
          <option value="7" selected>7 days</option>
          <option value="30">30 days</option>
        </select>

        <button type="button" id="generate-share-link" class="share-primary">
          Generate public link
        </button>

        <div id="share-generated-area" hidden>
          <label for="share-generated-url">Your public link</label>
          <div class="share-copy-row">
            <input id="share-generated-url" type="text" readonly>
            <button type="button" id="copy-share-link">Copy</button>
          </div>
          <p class="share-success" id="share-copy-status"></p>
        </div>

        <div class="share-existing">
          <h3>Existing public links</h3>
          <div id="share-links-list">
            <p>Loading links...</p>
          </div>
        </div>
      </div>
    </section>
  `;

  document.body.appendChild(dialog);

  dialog.querySelector("#share-close").addEventListener("click", closeShareDialog);

  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeShareDialog();
  });

  dialog.querySelector("#generate-share-link").addEventListener(
    "click",
    generatePublicShareLink
  );

  dialog.querySelector("#copy-share-link").addEventListener(
    "click",
    copyPublicShareLink
  );
}

let activeShareFileId = null;

function closeShareDialog() {
  const dialog = document.querySelector("#share-dialog");
  if (dialog) dialog.hidden = true;
  activeShareFileId = null;
}

async function openShareDialog(fileId, fileName) {
  ensureShareDialog();

  activeShareFileId = fileId;

  const dialog = document.querySelector("#share-dialog");
  dialog.querySelector("#share-file-name").textContent = fileName;

  dialog.querySelector("#share-generated-area").hidden = true;
  dialog.querySelector("#share-generated-url").value = "";
  dialog.querySelector("#share-copy-status").textContent = "";
  dialog.querySelector("#share-permission").value = "viewer";
  dialog.querySelector("#share-expiry").value = "7";

  dialog.hidden = false;

  await loadExistingShareLinks(fileId);
}

async function generatePublicShareLink() {
  if (!activeShareFileId) return;

  const button = document.querySelector("#generate-share-link");
  const permission = document.querySelector("#share-permission").value;
  const expiry = document.querySelector("#share-expiry").value;

  button.disabled = true;
  button.textContent = "Generating...";

  try {
    const payload = { permission };

    if (expiry !== "never") {
      payload.expiresAt = new Date(
        Date.now() + Number(expiry) * 24 * 60 * 60 * 1000
      ).toISOString();
    }

    const data = await apiRequest(
      `/api/files/${encodeURIComponent(activeShareFileId)}/share-links`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      }
    );

    const token = data.shareLink.url.split("/").pop();

    const publicUrl = new URL(
      `/share.html?token=${encodeURIComponent(token)}`,
      window.location.origin
    ).href;

    document.querySelector("#share-generated-url").value = publicUrl;
    document.querySelector("#share-generated-area").hidden = false;
    document.querySelector("#share-copy-status").textContent =
      "Public link created successfully.";

    await loadExistingShareLinks(activeShareFileId);

  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Generate public link";
  }
}

async function copyPublicShareLink() {
  const input = document.querySelector("#share-generated-url");
  const status = document.querySelector("#share-copy-status");

  try {
    await navigator.clipboard.writeText(input.value);
    status.textContent = "Link copied to clipboard!";
  } catch {
    input.focus();
    input.select();

    const copied = document.execCommand("copy");
    status.textContent = copied
      ? "Link copied to clipboard!"
      : "Please copy the link manually.";
  }
}

async function loadExistingShareLinks(fileId) {
  const container = document.querySelector("#share-links-list");
  container.innerHTML = "<p>Loading links...</p>";

  try {
    const data = await apiRequest(
      `/api/files/${encodeURIComponent(fileId)}/share-links`
    );

    if (!data.shareLinks || data.shareLinks.length === 0) {
      container.innerHTML = "<p>No public links created yet.</p>";
      return;
    }

    container.innerHTML = "";

    data.shareLinks.forEach(link => {
      const item = document.createElement("div");
      item.className = "share-existing-item";

      const details = document.createElement("div");
      details.className = "share-existing-details";

      const permission = document.createElement("strong");
      permission.textContent =
        link.permission.toUpperCase() + " ACCESS";

      const status = document.createElement("span");
      status.className = "share-status " + link.status;
      status.textContent = link.status.toUpperCase();

      const expiry = document.createElement("small");
      expiry.textContent = link.expires_at
        ? "Expires: " + new Date(link.expires_at).toLocaleString()
        : "No expiration";

      details.append(permission, status, expiry);
      item.appendChild(details);

      if (link.status === "active") {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "share-revoke";
        revoke.textContent = "Revoke";

        revoke.addEventListener("click", async () => {
          if (!confirm("Revoke this public link? It will stop working immediately.")) {
            return;
          }

          revoke.disabled = true;

          try {
            await apiRequest(
              `/api/files/${encodeURIComponent(fileId)}/share-links/${encodeURIComponent(link.id)}`,
              { method: "DELETE" }
            );

            await loadExistingShareLinks(fileId);
          } catch (error) {
            alert(error.message);
            revoke.disabled = false;
          }
        });

        item.appendChild(revoke);
      }

      container.appendChild(item);
    });

  } catch (error) {
    container.textContent = error.message;
  }
}

// Share button click handling
// File action click handling
document.addEventListener("click", async event => {
  const shareButton = event.target.closest(".share-file-button");

  if (shareButton) {
    openShareDialog(
      shareButton.dataset.fileId,
      shareButton.dataset.fileName
    ).catch(error => alert(error.message));
    return;
  }

  const deleteButton = event.target.closest(".delete-file-button");
  if (!deleteButton) return;

  const fileId = deleteButton.dataset.fileId;
  const fileName = deleteButton.dataset.fileName;

  if (!confirm(`Move "${fileName}" to trash?`)) return;

  deleteButton.disabled = true;

  try {
    await apiRequest(`/api/files/${encodeURIComponent(fileId)}`, {
      method: "DELETE"
    });

    await loadDashboard();
    showDashboardMessage("File moved to trash successfully.");
  } catch (error) {
    alert(error.message);
    deleteButton.disabled = false;
  }
});

function createFileRow(file) {
  const row = document.createElement("article");
  row.className = "file-row";

  const icon = document.createElement("div");
  icon.className = "file-type-icon";
  icon.textContent = "▤";

  const details = document.createElement("div");
  details.className = "file-details";

  const name = document.createElement("strong");
  name.textContent = file.display_name || "Untitled file";

  const meta = document.createElement("span");
  meta.textContent =
    `${formatBytes(file.latest_size_bytes)} · Updated ${formatDate(file.updated_at || file.created_at)}`;
  details.append(name, meta);

  const version = document.createElement("span");
  version.className = "file-version";
  version.textContent = file.latest_version ? `v${file.latest_version}` : "";

  const actions = document.createElement("div");
  actions.className = "file-actions";

  const download = document.createElement("a");
  download.className = "download-link";
  download.textContent = "Download";
  download.href = `/api/files/${encodeURIComponent(file.id)}/versions/${encodeURIComponent(file.latest_version || 1)}/download`;

  const share = document.createElement("button");
  share.type = "button";
  share.className = "share-file-button";
  share.textContent = "Share";
  share.dataset.fileId = file.id;
  share.dataset.fileName = file.display_name || "Untitled file";

  actions.append(download, share);

  if (currentUser?.id && file.owner_id === currentUser.id) {
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-file-button";
    deleteButton.textContent = "Delete";
    deleteButton.dataset.fileId = file.id;
    deleteButton.dataset.fileName = file.display_name || "Untitled file";
    actions.append(deleteButton);
  }

  row.append(icon, details, version, actions);
  return row;
}


function renderFileList(container, files, emptyText) {
  container.replaceChildren();
  if (!files.length) {
    container.append(makeEmptyState(emptyText));
    return;
  }
  files.forEach(file => container.append(createFileRow(file)));
}


function renderFiles() {
  const container = document.querySelector("#files-list");

  if (!container) return;

  const query = (
    document.querySelector("#file-search")?.value || ""
  ).trim().toLowerCase();

  const sort = document.querySelector("#file-sort")?.value || "recent";

  let files = allFiles.filter(file =>
    (file.folder_id || null) === currentFolderId &&
    (file.display_name || "").toLowerCase().includes(query)
  );

  // Sort files
  if (sort === "name") {
    files.sort((a, b) =>
      (a.display_name || "").localeCompare(b.display_name || "")
    );
  } else if (sort === "size") {
    files.sort((a, b) =>
      Number(b.latest_size_bytes || 0) -
      Number(a.latest_size_bytes || 0)
    );
  } else {
    files.sort((a, b) =>
      new Date(b.updated_at || b.created_at || 0) -
      new Date(a.updated_at || a.created_at || 0)
    );
  }

  // Render file list
  renderFileList(
    container,
    files,
    "No files match your search."
  );

  // Show all files button
  if (currentFolderId) {
    const backButton = document.createElement("button");

    backButton.textContent = "Show all files";
    backButton.type = "button";

    backButton.onclick = () => {
      currentFolderId = null;
      renderFiles();
    };

    container.prepend(backButton);
  }
}




function renderFolders() {
  const container = document.querySelector("#folders-list");

  container.replaceChildren();

  if (!allFolders.length) {
    container.append(
      makeEmptyState(
        "No folders yet. Create a folder to organize your files."
      )
    );
    return;
  }

  allFolders.forEach(folder => {
    const card = document.createElement("article");
    card.className = "folder-card";

    // Folder icon
    const icon = document.createElement("span");
    icon.className = "folder-card-icon";
    icon.textContent = "▰";

    // Folder name
    const name = document.createElement("strong");
    name.textContent = folder.folder_name || "Untitled folder";

    // Folder creation date
    const date = document.createElement("span");
    date.textContent = `Created ${formatDate(folder.created_at)}`;

    // Open folder button
    const openButton = document.createElement("button");
    openButton.textContent = "Open";
    openButton.type = "button";

    openButton.addEventListener("click", () => {
      currentFolderId = folder.id;

      setPage("files");

      renderFiles();
    });

    // Rename folder button
    const renameButton = document.createElement("button");
    renameButton.textContent = "Rename";
    renameButton.type = "button";

    renameButton.onclick = async () => {
      const newName = prompt(
        "Enter new folder name:",
        folder.folder_name || ""
      );

      if (!newName || !newName.trim()) {
        return;
      }

      try {
        await apiRequest(
          `/api/folders/${encodeURIComponent(folder.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              folderName: newName.trim()
            })
          }
        );

        await loadDashboard();

      } catch (error) {
        showDashboardMessage(error.message, true);
      }
    };

    // Delete folder button
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "Delete";
    deleteButton.type = "button";

    deleteButton.onclick = async () => {
      if (!confirm("Delete this folder?")) {
        return;
      }

      try {
        await apiRequest(
          `/api/folders/${encodeURIComponent(folder.id)}`,
          {
            method: "DELETE"
          }
        );

        await loadDashboard();

      } catch (error) {
        showDashboardMessage(error.message, true);
      }
    };

    // Append all elements to folder card
    card.append(
      icon,
      name,
      date,
      openButton,
      renameButton,
      deleteButton
    );

    // Add folder card to container
    container.append(card);
  });
}

function renderActivity(activities) {
  const container = document.querySelector("#activity-list");
  container.replaceChildren();
  if (!activities.length) {
    container.append(makeEmptyState("No recent activity to show."));
    return;
  }

  activities.forEach(item => {
    const row = document.createElement("article");
    row.className = "activity-row";
    const dot = document.createElement("span");
    dot.className = "activity-dot";
    const copy = document.createElement("div");
    copy.className = "activity-copy";
    const action = document.createElement("strong");
    action.textContent = item.action || item.action_type || item.event_type || item.activity_type || "Workspace activity";
    const detail = document.createElement("span");
    detail.textContent = item.display_name || item.file_name || item.description || item.target_name || "";
    const date = document.createElement("time");
    date.textContent = formatDate(item.created_at || item.occurred_at);
    copy.append(action, detail);
    row.append(dot, copy, date);
    container.append(row);
  });
}

async function loadDashboard() {
  dashboardMessage.hidden = true;
  try {
    const [usageData, filesData, foldersData] = await Promise.all([
      apiRequest("/api/storage/usage"),
      apiRequest("/api/files"),
      apiRequest("/api/folders")
    ]);

    const usage = usageData.usage;
    allFiles = filesData.files || [];
    allFolders = foldersData.folders || [];

    const quota = Number(usage.quotaBytes || 0);
    const used = Number(usage.usedBytes || 0);
    const available = Number(usage.availableBytes || 0);
    const percent = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;

    document.querySelector("#storage-used").textContent = formatBytes(used);
    document.querySelector("#storage-total").textContent = `of ${formatBytes(quota)}`;
    document.querySelector("#storage-available").textContent = `${formatBytes(available)} available`;
    document.querySelector("#storage-percent").textContent = `${percent.toFixed(1)}% used`;
    document.querySelector("#storage-progress").style.width = `${percent}%`;
    document.querySelector("#total-files").textContent = allFiles.length;
    document.querySelector("#total-folders").textContent = allFolders.length;

    const recent = [...allFiles].sort((a, b) =>
      new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
    ).slice(0, 5);
    renderFileList(document.querySelector("#recent-files-list"), recent, "No files uploaded yet. Use Upload file to add your first file.");

    renderFiles();
    renderFolders();

    const sharedFiles = allFiles.filter(file =>
      file.is_shared === true ||
      (currentUser?.id && file.owner_id && file.owner_id !== currentUser.id)
    );
    renderFileList(document.querySelector("#shared-list"), sharedFiles, "No files have been shared with you yet.");

    try {
      const activityData = await apiRequest("/api/activity?limit=20&offset=0");
      renderActivity(activityData.activities || []);
    } catch {
      renderActivity([]);
    }
  } catch (error) {
    showDashboardMessage(error.message, true);
  }
}

async function createFolder() {
  const folderName = window.prompt("Enter a name for the new folder:");
  if (folderName === null) return;
  if (!folderName.trim()) {
    showDashboardMessage("Folder name cannot be empty.", true);
    return;
  }

  try {
    const data = await apiRequest("/api/folders", {
      method: "POST",
      body: JSON.stringify({ folderName: folderName.trim() })
    });
    showDashboardMessage(data.message || "Folder created successfully.");
    await loadDashboard();
    setPage("folders");
  } catch (error) {
    showDashboardMessage(error.message, true);
  }
}

async function uploadSelectedFile(file) {
  if (!file) return;
  const formData = new FormData();

  formData.append("file", file);

  if (currentFolderId) {
  formData.append("folderId", currentFolderId);
}

  const uploadButton = document.querySelector("#upload-button");
  uploadButton.disabled = true;
  uploadButton.textContent = "Uploading…";

  try {
    const idempotencyKey = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : `upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const data = await apiRequest("/api/files", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: formData
    });

    showDashboardMessage(data.message || "File uploaded successfully.");
    await loadDashboard();
    setPage("files");
  } catch (error) {
    showDashboardMessage(error.message, true);
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = "↑ Upload file";
    fileInput.value = "";
  }
}

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));
switchModeButton.addEventListener("click", () => setMode(currentMode === "login" ? "register" : "login"));
togglePasswordButton.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  togglePasswordButton.textContent = showing ? "Show" : "Hide";
});
authForm.addEventListener("submit", handleAuthentication);
logoutButton.addEventListener("click", handleLogout);

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});
document.querySelectorAll("[data-go-page]").forEach(button => {
  button.addEventListener("click", () => setPage(button.dataset.goPage));
});
document.querySelector("#create-folder-button").addEventListener("click", createFolder);
document.querySelector("#upload-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", event => uploadSelectedFile(event.target.files[0]));
document.querySelector("#file-search").addEventListener("input", renderFiles);
document.querySelector("#file-sort").addEventListener("change", renderFiles);

async function initializeApp() {
  await checkConnection();
  await checkExistingSession();
}

setMode("login");
initializeApp();
