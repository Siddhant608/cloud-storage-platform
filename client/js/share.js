const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const fileName = document.querySelector("#public-file-name");
const fileInfo = document.querySelector("#public-file-info");
const errorBox = document.querySelector("#public-error");
const content = document.querySelector("#public-file-content");
const downloadButton = document.querySelector("#public-download");
const versionList = document.querySelector("#public-version-list");

function safeText(value) {
  return String(value ?? "");
}

function showPublicError(message) {
  fileName.textContent = "Unable to access this file";
  fileInfo.textContent = "";
  errorBox.textContent = message;
  errorBox.hidden = false;
  content.hidden = true;
}

async function loadPublicFile() {
  if (!token) {
    showPublicError("This sharing link is missing its access token.");
    return;
  }

  try {
    const response = await fetch(
      `/api/files/public/${encodeURIComponent(token)}`
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "This sharing link is invalid or unavailable.");
    }

    fileName.textContent = safeText(data.file.name);
    fileInfo.textContent =
      `${data.versions.length} version(s) available`;

    document.querySelector("#public-permission").textContent =
      data.file.permission === "editor"
        ? "Editor access"
        : "Viewer access";

    downloadButton.href =
      `/api/files/public/${encodeURIComponent(token)}/download`;

    downloadButton.setAttribute(
      "download",
      safeText(data.file.name)
    );

    versionList.innerHTML = "";

    if (!data.versions.length) {
      versionList.textContent = "No versions available.";
    }

    data.versions.forEach(version => {
      const item = document.createElement("article");
      item.className = "public-version";

      const details = document.createElement("div");

      const title = document.createElement("strong");
      title.textContent = `Version ${version.version_no}`;

      const meta = document.createElement("span");
      const size = Number(version.size_bytes || 0);
      const formattedSize = size < 1024 * 1024
        ? `${(size / 1024).toFixed(1)} KB`
        : `${(size / (1024 * 1024)).toFixed(2)} MB`;

      meta.textContent =
        `${formattedSize} · ${new Date(version.uploaded_at).toLocaleString()}`;

      details.append(title, meta);

      const versionDownload = document.createElement("a");
      versionDownload.textContent = "Download";
      versionDownload.href =
        `/api/files/public/${encodeURIComponent(token)}/versions/${encodeURIComponent(version.version_no)}/download`;

      item.append(details, versionDownload);
      versionList.appendChild(item);
    });

    content.hidden = false;

  } catch (error) {
    showPublicError(error.message);
  }
}

loadPublicFile();