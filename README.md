# CloudVault – Cloud File Storage & Collaboration Platform

## About the Project

CloudVault is a cloud file storage and collaboration platform that I am developing as part of my Full-Stack Development project.

The main idea behind this project is to allow users to upload and manage their files, organize them into folders, share files with other users, and maintain different versions of the same file.

One of the main features of CloudVault is its **file versioning system**. Instead of replacing an existing file whenever someone uploads an updated version, the platform stores the new version separately. This helps preserve the previous versions and makes it possible to download older versions whenever needed.

The backend is built using Node.js, Express, and PostgreSQL.

1. Technologies Used

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| Authentication | Express Session, bcrypt |
| File Uploads | Multer |
| Security | Helmet |
| Logging | Pino HTTP |
| Testing | Node.js Test Runner |

2. Project Structure

```text
cloud-storage-platform-starter/
│
├── .gitignore
│
└── server/
    ├── scripts/
    │   ├── seed_demo.js
    │   ├── seed_fsd.sql
    │   └── start-demo.js
    │
    ├── src/
    │   ├── db/
    │   │   └── migrations/
    │   │       └── 001_initial_schema.sql
    │   ├── routes/
    │   │   ├── auth.routes.js
    │   │   ├── files.routes.js
    │   │   ├── folders.routes.js
    │   │   ├── activity.routes.js
    │   │   └── health.routes.js
    │   ├── app.js
    │   └── server.js
    │
    ├── storage/
    │   └── blobs/
    │
    ├── tests/
    ├── .env.example
    ├── package.json
    └── package-lock.json
```

The `server` folder contains the backend code, database configuration, API routes, scripts, and tests.

The `storage/blobs` directory is used to store the actual uploaded files separately from the database. These files are not uploaded to GitHub.

3. Requirements

Before running the project, make sure you have installed:

- Node.js (version 24 or later recommended)
- npm
- PostgreSQL 18 or a compatible version
- Git

You can check the installed versions using:

```powershell
node --version
npm --version
psql --version
git --version
```

4. Download the Project

Clone the repository:

```powershell
git clone https://github.com/Siddhant608/cloud-storage-platform.git
```

Go inside the project folder:

```powershell
cd cloud-storage-platform
```

Then move into the backend folder:

```powershell
cd server
```

Install the required packages:

```powershell
npm install
```

5. Environment Setup

The project uses a `.env` file to store the database connection details and other configuration.

First, create the file using the example:

```powershell
Copy-Item .env.example .env
```

Open it:

```powershell
notepad .env
```

Add your local PostgreSQL credentials:

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/cloud_storage_db
```

Replace `YOUR_POSTGRES_PASSWORD` with your own PostgreSQL password.

A few things to remember:

- Do not upload your `.env` file to GitHub.
- Do not share your database password.
- Every team member should configure their own `.env` file.
- The `.env.example` file can be shared because it contains placeholder values.

6. Database Setup

CloudVault uses PostgreSQL to store user information, file details, folder information, permissions, version history, and activity records.

For the demonstration setup, create a separate database named `cloud_storage_demo_db`.

Run this command:

```powershell
psql -U postgres -h localhost -p 5432 -d postgres -c "CREATE DATABASE cloud_storage_demo_db;"
```

If the database already exists, there is no need to create it again.

Now initialize the database tables using the migration file:

```powershell
psql -U postgres -h localhost -p 5432 -d cloud_storage_demo_db -f .\src\db\migrations\001_initial_schema.sql
```

The migration creates the following tables:

1. Users
2. Folders
3. Files
4. File Versions
5. Folder Members
6. File Shares
7. Share Links
8. Storage Usage
9. Upload Requests
10. Activity Logs

It also creates indexes and database triggers to protect file-version and activity history from being modified or deleted.

**Note:** The demo setup uses `cloud_storage_demo_db` separately. The original `cloud_storage_db` is kept untouched.

]7. Adding Demo Data

To make testing and demonstration easier, I have added a demo data seeder.

Run it from the `server` directory:

```powershell
node .\scripts\seed_demo.js
```

It automatically creates sample users, folders, files, file versions, sharing records, and activity logs.

The current demo database contains:

| Data | Number of Records |
|---|---:|
| Users | 100 |
| Folders | 250 |
| Files | 350 |
| File Versions | 1,050 |
| Folder Memberships | 300 |
| File Shares | 300 |
| Share Links | 120 |
| Upload Requests | 1,200 |
| Activity Logs | 1,500 |
| **Total** | **5,270** |

The seeder also generates actual file contents in the local blob storage so that file downloads can be tested.

It has a safety check to prevent accidentally seeding a database that already contains data.

8. Running the Backend

For the demo setup, use:

```powershell
node .\scripts\start-demo.js
```

This script automatically connects the backend to `cloud_storage_demo_db`.

Alternatively, for normal development, you can use:

```powershell
npm run dev
```

The normal development command uses the database specified in your `.env` file, so make sure it points to the correct database first.

Once the server starts, the backend will be available at:

```text
http://localhost:3000
```

To check whether the backend and database are working, open:

```text
http://localhost:3000/api/health
```

A successful response means the server is running and the database connection is working.

9. Demo Account

For testing the application, use the following demo account:

| Field | Details |
|---|---|
| Email | `demo.owner@cloudvault.demo` |
| Password | `CloudVaultDemo!2026` |

These credentials are only meant for local testing and demonstration.

The project uses session-based authentication, so the session cookie needs to be maintained when accessing protected APIs.

10. Available API Endpoints

All APIs use the following base URL:

```text
http://localhost:3000/api
```

### Health Check

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Check server and database status |

### Authentication

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Log in |
| GET | `/auth/me` | Get current user details |
| POST | `/auth/logout` | Log out |

### File Management

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/files` | Upload a file |
| GET | `/files` | Get accessible files |
| PATCH | `/files/:id` | Update file details |
| DELETE | `/files/:id` | Delete a file |
| GET | `/files/:id/versions` | View version history |
| POST | `/files/:id/versions` | Upload a new version |
| GET | `/files/:id/versions/:versionNo/download` | Download a particular version |

File uploads use multipart form data with the field name `file`.

### File Sharing

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/files/:id/shares` | View file shares |
| POST | `/files/:id/shares` | Share a file with another user |
| DELETE | `/files/:id/shares/:shareId` | Revoke file access |

### Public Share Links

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/files/:id/share-links` | Create a share link |
| GET | `/files/:id/share-links` | View share links |
| DELETE | `/files/:id/share-links/:linkId` | Revoke a share link |
| GET | `/files/public/:token` | Access a shared file |
| GET | `/files/public/:token/download` | Download a shared file |
| GET | `/files/public/:token/versions/:versionNo/download` | Download an older version |
| POST | `/files/public/:token/versions` | Upload a version using an editor-enabled share link |

### Folder Management

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/folders` | Create a folder |
| GET | `/folders` | View folders |
| PATCH | `/folders/:id` | Update a folder |
| DELETE | `/folders/:id` | Delete a folder |

### Activity

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/activity` | View activity history |

Most of these endpoints require the user to be logged in. Public share-link endpoints are available without normal user authentication, subject to the permissions of the link.

11. File Versioning and Upload Handling

File versioning is one of the main parts of this project.

When a user uploads an updated file, CloudVault does not overwrite the previous file. Instead, it creates a new version and keeps the older version available.

Some of the things implemented in this part are:

- Separate storage for each file version.
- Unique version numbers for each file.
- SHA-256 checksums for file integrity.
- Idempotency keys to avoid duplicate uploads.
- Database transactions for safer uploads.
- Protection against duplicate or missing version numbers during concurrent uploads.

For upload requests, an `Idempotency-Key` header is used.

Example:

```text
Idempotency-Key: unique-upload-request-001
```

If the same completed request is repeated with the same key, it should not create another version.

12. Running Automated Tests

I have also added an automated test to check the upload and versioning functionality.

It checks:

- User authentication.
- File uploads.
- Duplicate upload prevention.
- Multiple uploads happening at the same time.
- Correct version numbering.
- File downloads.
- Downloaded file contents and checksums.

Before running the tests, set the demo login credentials in PowerShell:

```powershell
$env:CLOUDVAULT_TEST_EMAIL = "demo.owner@cloudvault.demo"
$env:CLOUDVAULT_TEST_PASSWORD = "CloudVaultDemo!2026"
```

Make sure the demo database is seeded and the backend is running.

Now run:

```powershell
npm test
```

The test includes 20 simultaneous uploads and checks that all versions are stored correctly without duplicate or missing version numbers.

13. Common Issues

### PostgreSQL is not connecting

Check whether PostgreSQL is running:

```powershell
Get-Service *postgres*
```

Also check the database connection and credentials in `.env`.

### Port 3000 is already in use

Check which process is using the port:

```powershell
netstat -ano | findstr :3000
```

### Environment file is missing

Make sure you have created `server/.env` from `.env.example`.

### Demo data is not available

Run the initial migration first and then execute:

```powershell
node .\scripts\seed_demo.js
```

### Automated tests are failing at login

Make sure the test credentials are set in the same PowerShell window where you run `npm test`.

14. Working on the Project Together

This project is being developed by two team members. To make sure both of us can work on the same codebase, we are using GitHub for version control.

For setting up the project on the other team member's system:

1. Clone the GitHub repository.
2. Install Node.js and PostgreSQL.
3. Open the `server` directory.
4. Run `npm install`.
5. Create a local `.env` file using `.env.example`.
6. Create the `cloud_storage_demo_db` database.
7. Run the initial database migration.
8. Run the demo seeder.
9. Start the backend using `node scripts/start-demo.js`.
10. Check the health endpoint and test the demo login.

Both members should use their own local database credentials. We can share code updates through GitHub using commits and pushes.

The `.env` file, database passwords, and locally stored file blobs should not be uploaded to the repository.

15. GitHub Repository

The source code is available here:

[CloudVault – GitHub Repository](https://github.com/Siddhant608/cloud-storage-platform)

---

*CloudVault – Secure Storage. Immutable Versions. Collaborative Access.*