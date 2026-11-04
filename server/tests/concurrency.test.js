
import { createHash, randomUUID } from "node:crypto";

const BASE_URL = "http://localhost:3000";
const EMAIL = process.env.CLOUDVAULT_TEST_EMAIL;
const PASSWORD = process.env.CLOUDVAULT_TEST_PASSWORD;

const TOTAL_UPLOADS = 20;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createUploadForm(content, filename) {
  const form = new FormData();

  form.append(
    "file",
    new Blob([content], { type: "text/plain" }),
    filename
  );

  return form;
}

async function parseResponse(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid response: ${text.slice(0, 500)}`);
  }
}

async function main() {
  assert(EMAIL && PASSWORD, "Set test credentials first.");

  // 1. LOGIN
  console.log("1. Logging in...");

  const loginResponse = await fetch(
    `${BASE_URL}/api/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    }
  );

  const loginData = await parseResponse(loginResponse);

  assert(loginResponse.ok, "Login failed.");

  const setCookie = loginResponse.headers.get("set-cookie");
  assert(setCookie, "Session cookie missing.");

  const cookie = setCookie.split(";")[0];
  const userId = loginData.user.id;

  console.log("Login successful.");

  // 2. CREATE INITIAL FILE
  console.log("\n2. Creating initial file...");

  const initialContent = "Initial concurrency test content.";
  const initialKey = randomUUID();
  const initialFilename = "concurrency-test.txt";

  const initialResponse = await fetch(`${BASE_URL}/api/files`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Idempotency-Key": initialKey
    },
    body: createUploadForm(initialContent, initialFilename)
  });

  const initialData = await parseResponse(initialResponse);

  assert(initialResponse.status === 201, "Initial upload failed.");
  assert(Number(initialData.version.version_no) === 1, "Expected Version 1.");

  const fileId = initialData.file.id;

  console.log("Created file:", fileId);

  // 3. RETRY THE SAME INITIAL REQUEST
  console.log("\n3. Testing initial-upload idempotency...");

  const initialRetry = await fetch(`${BASE_URL}/api/files`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Idempotency-Key": initialKey
    },
    body: createUploadForm(initialContent, initialFilename)
  });

  const initialRetryData = await parseResponse(initialRetry);

  assert(initialRetry.status === 200, "Repeated initial upload should return 200.");
  assert(
    initialRetryData.version.id === initialData.version.id,
    "Initial retry created a different version."
  );

  console.log("Repeated initial upload returned the original result.");

  // 4. SEND 20 SIMULTANEOUS UPLOADS
  console.log("\n4. Launching 20 simultaneous uploads...");

  const uploads = await Promise.all(
    Array.from({ length: TOTAL_UPLOADS }, async (_, index) => {
      const content =
        `Concurrent upload ${index + 1}. ` +
        `Unique content ${randomUUID()}`;

      const filename = `concurrent-${index + 1}.txt`;
      const key = randomUUID();

      const response = await fetch(
        `${BASE_URL}/api/files/${fileId}/versions`,
        {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Idempotency-Key": key
          },
          body: createUploadForm(content, filename)
        }
      );

      const data = await parseResponse(response);

      return { response, data, content, filename, key };
    })
  );

  const failures = uploads.filter(
    item => item.response.status !== 201
  );

  if (failures.length) {
    console.error(
      failures.map(item => ({
        status: item.response.status,
        error: item.data
      }))
    );

    throw new Error(`${failures.length} concurrent uploads failed.`);
  }

  console.log("All 20 uploads succeeded.");

  const expectedContent = new Map([
    [1, initialContent]
  ]);

  for (const item of uploads) {
    expectedContent.set(
      Number(item.data.version.version_no),
      item.content
    );
  }

  // 5. RETRY ONE COMPLETED VERSION UPLOAD
  console.log("\n5. Testing version-upload idempotency...");

  const original = uploads[0];

  const retryResponse = await fetch(
    `${BASE_URL}/api/files/${fileId}/versions`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Idempotency-Key": original.key
      },
      body: createUploadForm(original.content, original.filename)
    }
  );

  const retryData = await parseResponse(retryResponse);

  assert(retryResponse.status === 200, "Completed retry should return 200.");

  assert(
    retryData.version.id === original.data.version.id,
    "Retry returned a different version."
  );

  console.log("Repeated version upload returned its original result.");

  // 6. SAME KEY WITH DIFFERENT CONTENT MUST BE REJECTED
  console.log("\n6. Testing idempotency-key conflict...");

  const conflictResponse = await fetch(
    `${BASE_URL}/api/files/${fileId}/versions`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Idempotency-Key": original.key
      },
      body: createUploadForm(
        "Different content for the same key.",
        original.filename
      )
    }
  );

  const conflictData = await parseResponse(conflictResponse);

  assert(
    conflictResponse.status === 409,
    `Expected 409 for reused key with different content; received ${conflictResponse.status}.`
  );

  console.log("Conflicting idempotency key correctly rejected.");

  // 7. VERIFY VERSION HISTORY
  console.log("\n7. Checking version history...");

  const historyResponse = await fetch(
    `${BASE_URL}/api/files/${fileId}/versions`,
    {
      headers: { Cookie: cookie }
    }
  );

  const history = await parseResponse(historyResponse);

  assert(historyResponse.ok, "Could not retrieve history.");

  const versions = history.versions;

  assert(versions.length === 21, `Expected 21 versions, found ${versions.length}.`);

  const actualNumbers = versions
    .map(version => Number(version.version_no))
    .sort((a, b) => a - b);

  const expectedNumbers = Array.from(
    { length: 21 },
    (_, index) => index + 1
  );

  assert(
    JSON.stringify(actualNumbers) === JSON.stringify(expectedNumbers),
    `Incorrect version sequence: ${actualNumbers.join(", ")}`
  );

  assert(
    versions.every(version => version.uploader_id === userId),
    "Uploader attribution mismatch."
  );

  console.log("Version sequence:", actualNumbers.join(", "));
  console.log("No duplicates or gaps.");

  // 8. DOWNLOAD AND VERIFY ALL VERSIONS
  console.log("\n8. Downloading and verifying all versions...");

  for (const version of versions) {
    const number = Number(version.version_no);

    const response = await fetch(
      `${BASE_URL}/api/files/${fileId}/versions/${number}/download`,
      {
        headers: { Cookie: cookie }
      }
    );

    assert(response.status === 200, `Download failed for Version ${number}.`);

    const content = await response.text();

    assert(
      content === expectedContent.get(number),
      `Content mismatch in Version ${number}.`
    );

    const checksum = createHash("sha256")
      .update(content, "utf8")
      .digest("hex");

    assert(
      checksum === version.checksum_sha256,
      `Checksum mismatch in Version ${number}.`
    );
  }

  console.log("All 21 files downloaded.");
  console.log("All contents and checksums verified.");

  console.log("\n====================================");
  console.log("IDEMPOTENCY AND CONCURRENCY PASSED");
  console.log("====================================");
  console.log("Initial upload: 1");
  console.log("Concurrent uploads: 20");
  console.log("Final versions: 1 through 21");
  console.log("Same-request retries: No duplicate versions");
  console.log("Different content with same key: Rejected");
  console.log("Duplicate versions: 0");
  console.log("Missing versions: 0");
  console.log("Failed concurrent uploads: 0");
  console.log("Download failures: 0");
  console.log("====================================");
}

main().catch(error => {
  console.error("\nTEST FAILED");
  console.error(error);
  process.exitCode = 1;
});
