
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";
import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;

// Use the existing .env credentials, but connect ONLY
// to the new demonstration database.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing.");
}

const demoUrl = new URL(process.env.DATABASE_URL);
demoUrl.pathname = "/cloud_storage_demo_db";

const pool = new Pool({
  connectionString: demoUrl.toString(),
  max: 5,
  connectionTimeoutMillis: 10000
});

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, "..");

const blobDir = path.join(serverDir, "storage", "blobs");

const tokenOutput = path.join(
  serverDir,
  "storage",
  "demo-share-links.local.json"
);

// Dataset sizes
const USER_COUNT = 100;
const FOLDER_COUNT = 250;
const FILE_COUNT = 350;
const VERSIONS_PER_FILE = 3;
const MEMBERSHIP_COUNT = 300;
const FILE_SHARE_COUNT = 300;
const SHARE_LINK_COUNT = 120;
const UPLOAD_REQUEST_COUNT = 1200;
const ACTIVITY_COUNT = 1500;

// Demo names
const firstNames = [
  "Aarav", "Aditi", "Arjun", "Ananya",
  "Dev", "Diya", "Ishaan", "Ira",
  "Kabir", "Kiara", "Krishna", "Meera",
  "Neel", "Nisha", "Rohan", "Sana",
  "Vihaan", "Zoya", "Advik", "Myra",
  "Reyansh", "Tara", "Vivaan", "Aanya"
];

const lastNames = [
  "Sharma", "Verma", "Mehta", "Kapoor",
  "Reddy", "Nair", "Iyer", "Singh",
  "Chopra", "Malhotra", "Das", "Gupta",
  "Rao", "Khan", "Joshi", "Bose"
];

const folderNames = [
  "Projects", "Research", "Meeting Notes",
  "Reports", "Design Assets", "Coursework",
  "Shared Documents", "Finance",
  "Product Planning", "Presentations",
  "Archive", "Team Resources",
  "Development", "Marketing"
];

// Helpers
const randomDate = (days = 150) =>
  new Date(Date.now() - Math.floor(
    Math.random() * days * 86400000
  ));

const pick = (array) =>
  array[Math.floor(Math.random() * array.length)];

const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

// Actual downloadable file templates
const fileTemplates = [
  {
    name: "Project-Status-Report.md",
    type: "text/markdown",

    make: (number, version) => `
# Project Status Report

Project: CloudVault Demo Workspace
Document: ${number}
Revision: ${version}

## Summary

The team is tracking implementation,
testing, documentation and release readiness.

## Progress

- API endpoints reviewed
- Access-control checks documented
- Version history validated

## Next steps

Complete review and publish the next update.
`
  },

  {
    name: "Meeting-Notes.txt",
    type: "text/plain",

    make: (number, version) => `
Meeting Notes

Document: ${number}
Revision: ${version}

Attendees:
Product, Engineering, Design

Agenda:
1. Review milestones
2. Discuss open issues
3. Confirm next steps

Decisions:
- Keep version history immutable.
- Review sharing permissions.
- Publish updated action items.
`
  },

  {
    name: "Quarterly-Metrics.csv",
    type: "text/csv",

    make: (number, version) => `
metric,period,value,revision
active_users,Q1,${120 + number},${version}
files_uploaded,Q1,${450 + number},${version}
shares_created,Q1,${35 + number},${version}
storage_mb,Q1,${80 + number},${version}
`
  },

  {
    name: "Technical-Design.json",
    type: "application/json",

    make: (number, version) => JSON.stringify({
      document: `Technical Design ${number}`,
      revision: version,
      system: "CloudVault",
      components: [
        "authentication",
        "file storage",
        "version history",
        "sharing"
      ],
      reviewStatus: version === 3
        ? "approved"
        : "in-review"
    }, null, 2)
  },

  {
    name: "Sprint-Plan.md",
    type: "text/markdown",

    make: (number, version) => `
# Sprint Plan ${number}

Revision: ${version}

## Goals

- Improve upload reliability
- Validate access permissions
- Review version history
- Update documentation

This is sample CloudVault demonstration content.
`
  }
];

console.log("CloudVault demo seed configuration loaded.");

// ==========================================
// SECTION 2: GENERATE DEMO DATA
// ==========================================

// These arrays will be inserted into PostgreSQL
// in the next section.

const userRows = [];
const folderRows = [];
const fileRows = [];
const versionRows = [];

const folderIdsByOwner = new Map();
const blobPathsCreated = [];

// Generate users
console.log("Generating demo users...");

const demoPasswordHash = await bcrypt.hash(
  "CloudVaultDemo!2026",
  12
);

for (let i = 0; i < USER_COUNT; i++) {
  const id = randomUUID();

  const fullName = i === 0
    ? "CloudVault Demo Owner"
    : `${pick(firstNames)} ${pick(lastNames)}`;

  const email = i === 0
    ? "demo.owner@cloudvault.demo"
    : `member${String(i).padStart(3, "0")}@cloudvault.demo`;

  userRows.push({
    id,
    full_name: fullName,
    email,
    email_normalized: email.toLowerCase(),
    password_hash: demoPasswordHash,
    created_at: randomDate(180)
  });

  folderIdsByOwner.set(id, []);
}

// Generate folders
console.log("Generating demo folders...");

for (let i = 0; i < FOLDER_COUNT; i++) {
  const owner = pick(userRows);
  const ownerFolders = folderIdsByOwner.get(owner.id);

  const id = randomUUID();

  // Parent folders can only refer to folders
  // already generated for the same owner.
  const parent_folder_id =
    ownerFolders.length > 0 && Math.random() < 0.25
      ? pick(ownerFolders)
      : null;

  folderRows.push({
    id,
    owner_id: owner.id,
    parent_folder_id,
    folder_name: `${pick(folderNames)} ${i + 1}`,
    created_at: randomDate(140)
  });

  ownerFolders.push(id);
}

// Generate files and their three immutable versions
console.log("Generating demo files and versions...");

for (let i = 0; i < FILE_COUNT; i++) {
  const owner = pick(userRows);
  const ownerFolders = folderIdsByOwner.get(owner.id);

  const fileId = randomUUID();

  const folderId =
    ownerFolders.length > 0 && Math.random() < 0.85
      ? pick(ownerFolders)
      : null;

  const template = fileTemplates[i % fileTemplates.length];

  const displayName =
    `${String(i + 1).padStart(3, "0")}-${template.name}`;

  const createdAt = randomDate(120);

  fileRows.push({
    id: fileId,
    owner_id: owner.id,
    folder_id: folderId,
    display_name: displayName,
    deleted_at: null,
    created_at: createdAt,
    updated_at: createdAt
  });

  for (let version = 1; version <= VERSIONS_PER_FILE; version++) {
    const content = template.make(i + 1, version);
    const buffer = Buffer.from(content, "utf8");

    const blobKey = randomUUID();

    versionRows.push({
      id: randomUUID(),
      file_id: fileId,
      version_no: version,
      uploader_id: owner.id,
      blob_key: blobKey,
      size_bytes: buffer.length,
      checksum_sha256: sha256(buffer),
      content_type: template.type,
      uploaded_at: new Date(
        createdAt.getTime() +
        version * 60 * 60 * 1000
      ),
      content: buffer
    });
  }
}

console.log("Demo data generated:");
console.log("Users:", userRows.length);
console.log("Folders:", folderRows.length);
console.log("Files:", fileRows.length);
console.log("File versions:", versionRows.length);
console.log("Expected physical blobs:", versionRows.length);


// ==========================================
// SECTION 3: GENERATE REMAINING DEMO RECORDS
// ==========================================

const membershipRows = [];
const shareRows = [];
const shareLinkRows = [];
const storageRows = [];
const uploadRequestRows = [];
const activityRows = [];

const rawShareTokens = [];

// 1. Folder memberships
console.log("Generating folder memberships...");

const membershipPairs = new Set();

while (membershipRows.length < MEMBERSHIP_COUNT) {
  const folder = pick(folderRows);
  const member = pick(userRows);

  if (folder.owner_id === member.id) continue;

  const pair = `${folder.id}:${member.id}`;
  if (membershipPairs.has(pair)) continue;

  membershipPairs.add(pair);

  membershipRows.push({
    id: randomUUID(),
    folder_id: folder.id,
    user_id: member.id,
    role: Math.random() < 0.7 ? "viewer" : "editor",
    granted_by: folder.owner_id,
    created_at: randomDate(90)
  });
}

// 2. File shares
console.log("Generating file shares...");

const sharePairs = new Set();

while (shareRows.length < FILE_SHARE_COUNT) {
  const file = pick(fileRows);
  const recipient = pick(userRows);

  if (file.owner_id === recipient.id) continue;

  const pair = `${file.id}:${recipient.id}`;
  if (sharePairs.has(pair)) continue;

  sharePairs.add(pair);

  const revoked = Math.random() < 0.18;

  shareRows.push({
    id: randomUUID(),
    file_id: file.id,
    shared_with_user_id: recipient.id,
    role: Math.random() < 0.7 ? "viewer" : "editor",
    granted_by: file.owner_id,
    created_at: randomDate(90),
    revoked_at: revoked ? randomDate(20) : null
  });
}

// 3. Share links
console.log("Generating share links...");

for (let i = 0; i < SHARE_LINK_COUNT; i++) {
  const file = pick(fileRows);

  const token = randomBytes(36).toString("base64url");
  const revoked = i % 10 === 0;
  const expired = !revoked && i % 8 === 0;

  shareLinkRows.push({
    id: randomUUID(),
    file_id: file.id,
    token_hash: sha256(token),
    permission: Math.random() < 0.7 ? "viewer" : "editor",
    created_by: file.owner_id,
    expires_at: expired
      ? new Date(Date.now() - 86400000)
      : (i % 3 === 0
          ? new Date(Date.now() + 30 * 86400000)
          : null),
    revoked_at: revoked ? randomDate(10) : null,
    created_at: randomDate(60)
  });

  rawShareTokens.push({
    file_id: file.id,
    token,
    revoked,
    expired
  });
}

// 4. Storage usage
console.log("Generating storage usage...");

const usedBytesByUser = new Map();

for (const version of versionRows) {
  usedBytesByUser.set(
    version.uploader_id,
    (usedBytesByUser.get(version.uploader_id) || 0) +
    version.size_bytes
  );
}

for (const user of userRows) {
  storageRows.push({
    user_id: user.id,
    quota_bytes: 524288000,
    used_bytes: usedBytesByUser.get(user.id) || 0,
    reserved_bytes: 0
  });
}

// 5. Upload requests
console.log("Generating upload requests...");

for (let i = 0; i < UPLOAD_REQUEST_COUNT; i++) {
  const user = pick(userRows);

  const status = i % 20 === 0
    ? "pending"
    : i % 10 === 0
      ? "failed"
      : "completed";

  const version = pick(versionRows);

  uploadRequestRows.push({
    id: randomUUID(),
    uploader_id: user.id,
    idempotency_key: `demo-${user.id}-${String(i + 1).padStart(5, "0")}`,
    request_payload_hash: sha256(
      `demo-upload-${user.id}-${i + 1}`
    ),
    file_id: status === "completed" ? version.file_id : null,
    version_id: status === "completed" ? version.id : null,
    status,
    created_at: randomDate(60)
  });
}

// 6. Activity logs
console.log("Generating activity logs...");

const activityActions = [
  "file.uploaded",
  "file.version.created",
  "file.downloaded",
  "file.shared",
  "file.share.revoked",
  "share_link.created",
  "share_link.revoked",
  "folder.created",
  "folder.member.added",
  "file.previewed"
];

for (let i = 0; i < ACTIVITY_COUNT; i++) {
  const file = pick(fileRows);
  const version = pick(
    versionRows.filter(v => v.file_id === file.id)
  );

  activityRows.push({
    id: randomUUID(),
    actor_user_id: Math.random() < 0.03
      ? null
      : file.owner_id,
    action: pick(activityActions),
    file_id: file.id,
    version_id: version.id,
    request_id: null,
    metadata: {
      fileName: file.display_name,
      source: "demo-seed",
      eventNumber: i + 1
    },
    occurred_at: randomDate(60)
  });
}

console.log("Remaining demo data generated:");
console.log("Folder memberships:", membershipRows.length);
console.log("File shares:", shareRows.length);
console.log("Share links:", shareLinkRows.length);
console.log("Storage usage:", storageRows.length);
console.log("Upload requests:", uploadRequestRows.length);
console.log("Activity logs:", activityRows.length);


// ==========================================
// SECTION 4: CREATE BLOBS AND INSERT DATABASE
// ==========================================

async function insertRows(client, table, rows) {
  if (rows.length === 0) return;

  const columns = Object.keys(rows[0]);

  // Keep batches small to avoid PostgreSQL parameter limits.
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    const values = [];
    const placeholders = [];

    for (const row of batch) {
      const rowPlaceholders = [];

      for (const column of columns) {
        values.push(row[column]);
        rowPlaceholders.push(`$${values.length}`);
      }

      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    const sql = `
      INSERT INTO ${table} (${columns.join(", ")})
      VALUES ${placeholders.join(", ")}
    `;

    await client.query(sql, values);
  }
}

async function main() {
  console.log("\n================================");
  console.log("CLOUDVAULT DEMO DATABASE SEED");
  console.log("================================\n");

  await fs.mkdir(blobDir, { recursive: true });

  // SAFETY CHECK: Do not seed a non-empty demo database.
  const check = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM folders) AS folders,
      (SELECT COUNT(*) FROM files) AS files,
      (SELECT COUNT(*) FROM file_versions) AS versions,
      (SELECT COUNT(*) FROM folder_members) AS memberships,
      (SELECT COUNT(*) FROM file_shares) AS shares,
      (SELECT COUNT(*) FROM share_links) AS links,
      (SELECT COUNT(*) FROM storage_usage) AS usage,
      (SELECT COUNT(*) FROM upload_requests) AS requests,
      (SELECT COUNT(*) FROM activity_logs) AS activities
  `);

  const existingCounts = Object.values(check.rows[0]);

  if (existingCounts.some(value => Number(value) !== 0)) {
    throw new Error(
      "Demo database is not empty. Seeding cancelled for safety."
    );
  }

  console.log("Safety check passed: demo database is empty.");

  let committed = false;

  try {
    // Create actual downloadable blob files.
    console.log("\nCreating physical blobs...");

    for (const version of versionRows) {
      const blobPath = path.join(blobDir, version.blob_key);

      await fs.writeFile(blobPath, version.content, {
        flag: "wx"
      });

      blobPathsCreated.push(blobPath);
    }

    console.log(`Created ${blobPathsCreated.length} blobs.`);

    // Insert all records in one transaction.
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      console.log("\nInserting users...");
      await insertRows(client, "users", userRows);

      console.log("Inserting folders...");
      await insertRows(client, "folders", folderRows);

      console.log("Inserting files...");
      await insertRows(client, "files", fileRows);

      console.log("Inserting file versions...");
      const databaseVersions = versionRows.map(
        ({ content, ...row }) => row
      );
      await insertRows(client, "file_versions", databaseVersions);

      console.log("Inserting folder memberships...");
      await insertRows(client, "folder_members", membershipRows);

      console.log("Inserting file shares...");
      await insertRows(client, "file_shares", shareRows);

      console.log("Inserting share links...");
      await insertRows(client, "share_links", shareLinkRows);

      console.log("Inserting storage usage...");
      await insertRows(client, "storage_usage", storageRows);

      console.log("Inserting upload requests...");
      await insertRows(client, "upload_requests", uploadRequestRows);

      console.log("Inserting activity logs...");
      await insertRows(client, "activity_logs", activityRows);

      await client.query("COMMIT");
      committed = true;

      console.log("\nDatabase transaction committed.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    // Save raw share tokens locally for demo testing.
    // This file must not be committed to GitHub.
    try {
      await fs.mkdir(path.dirname(tokenOutput), {
        recursive: true
      });

      await fs.writeFile(
        tokenOutput,
        JSON.stringify(rawShareTokens, null, 2),
        { flag: "wx" }
      );

      console.log("Share-link tokens saved locally.");
    } catch (error) {
      console.error(
        "WARNING: Database was seeded, but token file could not be saved:",
        error.message
      );
      console.error(
        "Do not rerun the seed script. The database is already populated."
      );
    }

    // Final report
    const totalRows =
      userRows.length +
      folderRows.length +
      fileRows.length +
      versionRows.length +
      membershipRows.length +
      shareRows.length +
      shareLinkRows.length +
      storageRows.length +
      uploadRequestRows.length +
      activityRows.length;

    console.log("\n================================");
    console.log("DEMO DATABASE SEEDED SUCCESSFULLY");
    console.log("================================");
    console.log("Users:", userRows.length);
    console.log("Folders:", folderRows.length);
    console.log("Files:", fileRows.length);
    console.log("File versions:", versionRows.length);
    console.log("Folder memberships:", membershipRows.length);
    console.log("File shares:", shareRows.length);
    console.log("Share links:", shareLinkRows.length);
    console.log("Storage usage:", storageRows.length);
    console.log("Upload requests:", uploadRequestRows.length);
    console.log("Activity logs:", activityRows.length);
    console.log("--------------------------------");
    console.log("TOTAL DATABASE ROWS:", totalRows);
    console.log("PHYSICAL BLOBS CREATED:", blobPathsCreated.length);
    console.log("--------------------------------");
    console.log("Demo login:");
    console.log("Email: demo.owner@cloudvault.demo");
    console.log("Password: CloudVaultDemo!2026");
    console.log("================================");

  } catch (error) {
    if (!committed) {
      console.error("\nSeed failed. Cleaning up newly created blobs...");

      for (const blobPath of blobPathsCreated) {
        try {
          await fs.unlink(blobPath);
        } catch {
          // Ignore cleanup errors for individual new blobs.
        }
      }
    }

    throw error;
  }
}

try {
  await main();
} catch (error) {
  console.error("\nDEMO SEED FAILED:");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
