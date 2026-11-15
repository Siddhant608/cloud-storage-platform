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
let currentPage = "overview";
let currentFolderId = null;
let activityItems = [];
let activityOffset = 0;
let activityHasMore = false;
let activityCategory = "all";
let activityLoading = false;

const pageInfo = {
  overview: ["Overview", "Your files and storage at a glance."],
  files: ["My files", "Browse and manage your stored files."],
  folders: ["Folders", "Organize your files into folders."],
  shared: ["Shared", "Files shared with your account."],
  trash: ["Trash", "Restore deleted files or permanently remove them."],
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
  document.querySelector("#upload-button").hidden =
    page === "activity" || page === "trash";

  if (page === "trash") {
    loadTrash();
  }

  if (page === "folders") {
    renderFolders();
  }

  if (page === "activity") {
    loadActivity({ reset: true });
  }
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
// FILE VERSION HISTORY
// ==========================================

function ensureVersionHistoryDialog() {
  if (document.querySelector("#version-history-dialog")) return;

  const dialog = document.createElement("div");
  dialog.id = "version-history-dialog";
  dialog.className = "share-overlay";
  dialog.hidden = true;

  dialog.innerHTML = `
    <section class="share-modal history-modal"
      role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="share-modal-header">
        <div>
          <span class="share-eyebrow">CLOUDVAULT HISTORY</span>
          <h2 id="history-title">Version history</h2>
          <p id="history-file-name"></p>
        </div>
        <button type="button" class="share-close"
          id="history-close" aria-label="Close">&times;</button>
      </div>
      <div class="share-modal-body">
        <div id="history-loading">Loading version history...</div>
        <div id="history-list"></div>
      </div>
    </section>
  `;

  document.body.appendChild(dialog);

  dialog.querySelector("#history-close").addEventListener(
    "click", closeVersionHistory
  );

  dialog.addEventListener("click", event => {
    if (event.target === dialog) closeVersionHistory();
  });
}

function closeVersionHistory() {
  const dialog = document.querySelector("#version-history-dialog");
  if (dialog) dialog.hidden = true;
}

function formatExactDateTime(value) {
  if (!value) return "Date unavailable";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short"
  }).format(date);
}

function renderVersionHistory(versions, fileId) {
  const container = document.querySelector("#history-list");
  container.replaceChildren();

  if (!versions.length) {
    container.append(makeEmptyState("No version history is available."));
    return;
  }

  versions.forEach(version => {
    const item = document.createElement("article");
    item.className = "history-version-item";

    const details = document.createElement("div");
    details.className = "history-version-details";

    const heading = document.createElement("strong");
    heading.textContent = `Version ${version.version_no}`;

    const uploader = document.createElement("span");
    uploader.textContent =
      `Uploaded by ${version.uploader_name || "Unknown user"}`;

    const size = document.createElement("span");
    size.textContent = `Size: ${formatBytes(version.size_bytes)}`;

    const date = document.createElement("time");
    date.textContent = formatExactDateTime(version.uploaded_at);
    date.dateTime = version.uploaded_at || "";

    details.append(heading, uploader, size, date);

    const download = document.createElement("a");
    download.className = "download-link history-download";
    download.textContent = "Download";
    download.href =
      `/api/files/${encodeURIComponent(fileId)}/versions/${encodeURIComponent(version.version_no)}/download`;

    item.append(details, download);
    container.append(item);
  });
}

async function openVersionHistory(fileId, fileName) {
  ensureVersionHistoryDialog();

  const dialog = document.querySelector("#version-history-dialog");
  const loading = dialog.querySelector("#history-loading");
  const container = dialog.querySelector("#history-list");

  dialog.querySelector("#history-file-name").textContent = fileName;
  loading.hidden = false;
  loading.textContent = "Loading version history...";
  container.replaceChildren();
  dialog.hidden = false;

  try {
    const data = await apiRequest(
      `/api/files/${encodeURIComponent(fileId)}/versions`
    );

    renderVersionHistory(data.versions || [], fileId);
    loading.hidden = true;
  } catch (error) {
    loading.hidden = false;
    loading.textContent = error.message;
  }
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
  const folderDeleteButton = event.target.closest(".delete-folder-button");

  if (folderDeleteButton) {
    const folderId = folderDeleteButton.dataset.folderId;
    const folderName = folderDeleteButton.dataset.folderName;

    const confirmed = confirm(
      `Delete folder "${folderName}" and all its subfolders?\n\n` +
      `All active files you own inside this folder tree will be moved to Trash. ` +
      `Their versions will remain intact.\n\n` +
      `The folder structure will be permanently removed. If you restore these files later, ` +
      `they will appear in My Files (root), because their original folders will no longer exist.\n\n` +
      `This action cannot be undone for the folder structure.`
    );

    if (!confirmed) return;

    folderDeleteButton.disabled = true;

    try {
      const data = await apiRequest(
        `/api/folders/${encodeURIComponent(folderId)}`,
        { method: "DELETE" }
      );

      await loadDashboard();
      await loadTrash();

      const count = Number(data.trashedFileCount || 0);

      showDashboardMessage(
        data.message || `Folder deleted. ${count} files moved to Trash.`
      );
    } catch (error) {
      alert(error.message);
      folderDeleteButton.disabled = false;
    }

    return;
  }
  const newVersionButton = event.target.closest(".new-version-button");

  if (newVersionButton) {
    uploadNewVersion(
      newVersionButton.dataset.fileId,
      newVersionButton.dataset.fileName,
      newVersionButton
    );
    return;
  }
  const historyButton = event.target.closest(".history-file-button");

  if (historyButton) {
    openVersionHistory(
      historyButton.dataset.fileId,
      historyButton.dataset.fileName
    ).catch(error => alert(error.message));
    return;
  }

  const shareButton = event.target.closest(".share-file-button");

  if (shareButton) {
    openShareDialog(
      shareButton.dataset.fileId,
      shareButton.dataset.fileName
    ).catch(error => alert(error.message));
    return;
  }

  const restoreButton = event.target.closest(".restore-file-button");
  if (restoreButton) {
    const fileId = restoreButton.dataset.fileId;
    const fileName = restoreButton.dataset.fileName;

    if (!confirm(`Restore "${fileName}" to My Files?`)) return;

    restoreButton.disabled = true;
    try {
      const data = await apiRequest(
        `/api/files/${encodeURIComponent(fileId)}/restore`,
        { method: "PATCH" }
      );
      await loadDashboard();
      await loadTrash();
      showDashboardMessage(data.message || "File restored successfully.");
    } catch (error) {
      alert(error.message);
      restoreButton.disabled = false;
    }
    return;
  }

  const purgeButton = event.target.closest(".purge-file-button");
  if (purgeButton) {
    const fileId = purgeButton.dataset.fileId;
    const fileName = purgeButton.dataset.fileName;

    if (!confirm(
      `Permanently delete "${fileName}"? This action cannot be undone and all stored versions will be removed.`
    )) return;

    purgeButton.disabled = true;
    try {
      const data = await apiRequest(
        `/api/files/${encodeURIComponent(fileId)}/purge`,
        { method: "DELETE" }
      );
      await loadDashboard();
      await loadTrash();

      const message = data.cleanupPending
        ? "File permanently deleted. Physical storage cleanup is pending and will be retried."
        : "File permanently deleted.";
      showDashboardMessage(message);
    } catch (error) {
      alert(error.message);
      purgeButton.disabled = false;
    }
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

  const history = document.createElement("button");
  history.type = "button";
  history.className = "history-file-button";
  history.textContent = "History";
  history.dataset.fileId = file.id;
  history.dataset.fileName = file.display_name || "Untitled file";
  const newVersion = document.createElement("button");
  newVersion.type = "button";
  newVersion.className = "new-version-button";
  newVersion.textContent = "New Version";
  newVersion.dataset.fileId = file.id;
  newVersion.dataset.fileName = file.display_name || "Untitled file";

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

  actions.append(history, download, share);

  if (currentUser?.id && file.owner_id === currentUser.id) {
    actions.append(newVersion);
  }

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

function renderTrash(files) {
  const container = document.querySelector("#trash-list");
  container.replaceChildren();

  if (!files.length) {
    container.append(makeEmptyState("Your Trash is empty."));
    return;
  }

  files.forEach(file => {
    const row = document.createElement("article");
    row.className = "file-row trash-file-row";

    const icon = document.createElement("div");
    icon.className = "file-type-icon trash-file-icon";
    icon.textContent = "🗑";

    const details = document.createElement("div");
    details.className = "file-details";

    const name = document.createElement("strong");
    name.textContent = file.display_name || "Untitled file";

    const meta = document.createElement("span");
    meta.textContent =
      `Deleted ${formatDate(file.deleted_at)} · ${file.version_count || 0} version(s) · ${formatBytes(file.total_size_bytes || 0)}`;

    details.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "file-actions trash-actions";

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "restore-file-button";
    restore.textContent = "↶ Restore";
    restore.dataset.fileId = file.id;
    restore.dataset.fileName = file.display_name || "Untitled file";

    const purge = document.createElement("button");
    purge.type = "button";
    purge.className = "purge-file-button";
    purge.textContent = "Delete permanently";
    purge.dataset.fileId = file.id;
    purge.dataset.fileName = file.display_name || "Untitled file";

    actions.append(restore, purge);
    row.append(icon, details, actions);
    container.append(row);
  });
}

async function loadTrash() {
  const container = document.querySelector("#trash-list");
  if (!container) return;

  container.replaceChildren();
  const loading = document.createElement("div");
  loading.className = "empty-state";
  loading.textContent = "Loading deleted files…";
  container.append(loading);

  try {
    const data = await apiRequest("/api/files/trash");
    renderTrash(data.files || []);
  } catch (error) {
    container.replaceChildren();
    const message = makeEmptyState(error.message || "Unable to load Trash.");
    message.classList.add("trash-error");
    container.append(message);
  }
}

function renderFiles() {
  const query = (document.querySelector("#file-search")?.value || "").trim().toLowerCase();
  const sort = document.querySelector("#file-sort")?.value || "recent";
  let files = allFiles.filter(file => (file.display_name || "").toLowerCase().includes(query));

  if (sort === "name") {
    files.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
  } else if (sort === "size") {
    files.sort((a, b) => Number(b.latest_size_bytes || 0) - Number(a.latest_size_bytes || 0));
  } else {
    files.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
  }

  renderFileList(document.querySelector("#files-list"), files, "No files match your search.");
}

function renderFolders() {
  const container = document.querySelector("#folders-list");
  const breadcrumbs = document.querySelector("#folder-breadcrumbs");
  const filesContainer = document.querySelector("#folder-files-list");

  container.replaceChildren();
  breadcrumbs.replaceChildren();

  // Root breadcrumb.
  const rootButton = document.createElement("button");
  rootButton.type = "button";
  rootButton.className = "breadcrumb-button";
  rootButton.textContent = "My folders";
  rootButton.addEventListener("click", () => {
    currentFolderId = null;
    renderFolders();
  });
  breadcrumbs.append(rootButton);

  // Build the current folder path.
  const path = [];
  let current = allFolders.find(folder => folder.id === currentFolderId);
  let safetyCounter = 0;

  while (current && safetyCounter++ < allFolders.length) {
    path.unshift(current);
    current = allFolders.find(
      folder => folder.id === current.parent_folder_id
    );
  }

  // If the selected folder is no longer available, return to root.
  if (currentFolderId && !path.length) {
    currentFolderId = null;
  }

  path.forEach(folder => {
    const separator = document.createElement("span");
    separator.className = "breadcrumb-separator";
    separator.textContent = "/";
    breadcrumbs.append(separator);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "breadcrumb-button";
    button.textContent = folder.folder_name;
    button.addEventListener("click", () => {
      currentFolderId = folder.id;
      renderFolders();
    });
    breadcrumbs.append(button);
  });

  // Display only immediate child folders.
  const childFolders = allFolders.filter(
    folder => (folder.parent_folder_id || null) === currentFolderId
  );

  if (!childFolders.length) {
    container.append(
      makeEmptyState(
        currentFolderId
          ? "No subfolders here. You can create one using New Folder."
          : "No folders yet. Create a folder to organize your files."
      )
    );
  } else {
    childFolders.forEach(folder => {
      const card = document.createElement("article");
      card.className = "folder-card folder-open-card";

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "folder-open-button";
      openButton.setAttribute(
        "aria-label",
        `Open folder ${folder.folder_name}`
      );

      const icon = document.createElement("span");
      icon.className = "folder-card-icon";
      icon.textContent = "📁";

      const name = document.createElement("strong");
      name.textContent = folder.folder_name || "Untitled folder";

      const date = document.createElement("span");
      date.textContent = `Created ${formatDate(folder.created_at)}`;

      openButton.append(icon, name, date);

      openButton.addEventListener("click", () => {
        currentFolderId = folder.id;
        renderFolders();
      });

      card.append(openButton);

      // Only folder owners can see the delete button.
      if (folder.role === "owner") {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-folder-button";
        deleteButton.dataset.folderId = folder.id;
        deleteButton.dataset.folderName = folder.folder_name || "Untitled folder";
        deleteButton.textContent = "Delete Folder";
        deleteButton.setAttribute(
          "aria-label",
          `Delete folder ${folder.folder_name}`
        );

        card.append(deleteButton);
      }

      container.append(card);
    });
  }

  // Display files belonging only to this folder.
  const folderFiles = allFiles.filter(
    file => (file.folder_id || null) === currentFolderId
  );

  renderFileList(
    filesContainer,
    folderFiles,
    currentFolderId
      ? "This folder has no files yet. Use Upload file to add one."
      : "No files in the root directory. Open a folder or upload a file here."
  );
}

function activityActionLabel(action) {
  const labels = {
    VERSION_CREATED: "New file version uploaded",
    FILE_DOWNLOADED: "File downloaded",
    FILE_RENAMED: "File renamed",
    FILE_DELETED: "File moved to Trash",
    FILE_PURGED: "File permanently deleted",
    FILE_RESTORED: "File restored",
    FILE_SHARED: "File shared",
    SHARE_REVOKED: "File access revoked",
    SHARE_LINK_CREATED: "Share link created",
    SHARE_LINK_REVOKED: "Share link revoked",
    FOLDER_CREATED: "Folder created",
    FOLDER_RENAMED: "Folder renamed",
    FOLDER_DELETED: "Folder deleted"
  };

  return labels[action] || "Workspace activity";
}

function renderActivity(activities) {
  const container = document.querySelector("#activity-list");
  container.replaceChildren();

  if (!activities.length) {
    container.append(makeEmptyState("No activity found for this category."));
    return;
  }

  activities.forEach(item => {
    const metadata = typeof item.metadata === "string"
      ? (() => {
          try { return JSON.parse(item.metadata); }
          catch { return {}; }
        })()
      : (item.metadata || {});

    const row = document.createElement("article");
    row.className = "activity-row";

    const dot = document.createElement("span");
    dot.className = "activity-dot";

    const copy = document.createElement("div");
    copy.className = "activity-copy";

    const action = document.createElement("strong");
    action.textContent = activityActionLabel(item.action);

    const detail = document.createElement("span");

    const targetName =
      item.display_name ||
      metadata.fileName ||
      metadata.folderName ||
      metadata.newName ||
      metadata.targetName ||
      "";

    const details = [];

    if (targetName) details.push(targetName);

    const versionNo = item.version_no || metadata.versionNo;
    if (versionNo) details.push(`Version ${versionNo}`);

    if (metadata.oldName && metadata.newName) {
      details.push(`${metadata.oldName} → ${metadata.newName}`);
    }

    if (metadata.trashedFileCount !== undefined) {
      details.push(`${metadata.trashedFileCount} file(s) moved to Trash`);
    }

    if (metadata.deletedFolderCount !== undefined) {
      details.push(`${metadata.deletedFolderCount} folder(s) deleted`);
    }

    if (metadata.downloadType === "authenticated") {
      details.push("Authenticated download");
    }

    detail.textContent = [
      item.actor_name || "You",
      ...details
    ].join(" · ");

    const date = document.createElement("time");
    const timestamp = item.occurred_at ? new Date(item.occurred_at) : null;

    date.textContent = timestamp && !Number.isNaN(timestamp.getTime())
      ? timestamp.toLocaleString()
      : "Date unavailable";

    if (timestamp && !Number.isNaN(timestamp.getTime())) {
      date.dateTime = timestamp.toISOString();
    }

    copy.append(action, detail);
    row.append(dot, copy, date);
    container.append(row);
  });
}

async function loadActivity({ reset = true } = {}) {
  if (activityLoading) return;

  if (reset) {
    activityOffset = 0;
    activityHasMore = false;
    activityItems = [];
  }

  activityLoading = true;

  const status = document.querySelector("#activity-status");
  const loadMoreButton = document.querySelector("#activity-load-more");
  const refreshButton = document.querySelector("#refresh-activity-button");

  status.textContent = reset ? "Loading activity..." : "Loading more activity...";
  loadMoreButton.disabled = true;
  refreshButton.disabled = true;

  if (reset) {
    renderActivity([]);
    document.querySelector("#activity-list").firstChild.textContent =
      "Loading activity...";
  }

  try {
    const query = new URLSearchParams({
      limit: "20",
      offset: String(activityOffset),
      category: activityCategory
    });

    const data = await apiRequest(`/api/activity?${query.toString()}`);
    const received = data.activities || [];

    activityItems = reset
      ? received
      : [...activityItems, ...received];

    activityOffset += received.length;
    activityHasMore = Boolean(data.pagination?.hasMore);

    renderActivity(activityItems);

    status.textContent = activityItems.length
      ? `Showing ${activityItems.length} activity event(s).`
      : "No activity found for this category.";

    loadMoreButton.hidden = !activityHasMore;
  } catch (error) {
    status.textContent = `Unable to load activity: ${error.message}`;

    if (!activityItems.length) {
      renderActivity([]);
      document.querySelector("#activity-list").firstChild.textContent =
        "Activity could not be loaded. Use Refresh to try again.";
    }
  } finally {
    activityLoading = false;
    loadMoreButton.disabled = false;
    refreshButton.disabled = false;
  }
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
      body: JSON.stringify({ folderName: folderName.trim(), parentFolderId: currentPage === "folders" ? currentFolderId : null })
    });
    showDashboardMessage(data.message || "Folder created successfully.");
    await loadDashboard();
    setPage("folders");
  } catch (error) {
    showDashboardMessage(error.message, true);
  }
}

async function uploadNewVersion(fileId, fileName, button) {
  const input = document.createElement("input");
  input.type = "file";
  input.hidden = true;

  input.addEventListener("cancel", () => input.remove(), { once: true });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    button.disabled = true;
    button.textContent = "Uploading…";

    try {
      const idempotencyKey = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `version-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const data = await apiRequest(
        `/api/files/${encodeURIComponent(fileId)}/versions`,
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: formData
        }
      );

      await loadDashboard();

      const versionNo = data.version?.version_no;
      showDashboardMessage(
        versionNo
          ? `New version ${versionNo} uploaded successfully.`
          : data.message || "New version uploaded successfully."
      );

      await openVersionHistory(fileId, fileName);

    } catch (error) {
      alert(error.message);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "New Version";
      }
    }
  });

  document.body.appendChild(input);
  input.click();
}
async function uploadSelectedFile(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);

  if (currentPage === "folders" && currentFolderId) {
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
    setPage(currentPage === "folders" ? "folders" : "files");
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
document.querySelectorAll("[data-activity-category]").forEach(button => {
  button.addEventListener("click", () => {
    activityCategory = button.dataset.activityCategory;

    document.querySelectorAll("[data-activity-category]").forEach(filter => {
      filter.classList.toggle(
        "active",
        filter.dataset.activityCategory === activityCategory
      );
    });

    loadActivity({ reset: true });
  });
});

document.querySelector("#refresh-activity-button").addEventListener("click", () => {
  loadActivity({ reset: true });
});

document.querySelector("#activity-load-more").addEventListener("click", () => {
  loadActivity({ reset: false });
});
document.querySelector("#refresh-trash-button").addEventListener("click", loadTrash);

async function initializeApp() {
  await checkConnection();
  await checkExistingSession();
}

setMode("login");
initializeApp();
