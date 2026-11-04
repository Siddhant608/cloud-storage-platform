# CloudVault — Cloud File Storage & Collaboration Platform

Starter scaffold for the Full-Stack Development project guide.

## Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js and Express
- Database: PostgreSQL
- File contents: private local blob storage during development (to be implemented)

PostgreSQL will store users, folders, file metadata, permissions, version records, quota information, and activity history. Actual file bytes will be stored separately under unique immutable storage keys.

## Requirements

- Node.js and npm
- PostgreSQL
- Git (recommended)

## Setup on Windows PowerShell

1. Create a PostgreSQL database named `cloud_storage_db`.
2. Open a terminal in the `server` folder.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Copy `.env.example` to `.env` and replace `YOUR_POSTGRES_PASSWORD` with the password configured for your local PostgreSQL user.
5. Start the development server:

   ```powershell
   npm run dev
   ```

6. Open `http://localhost:3000` in a browser. The page checks both the Express API and PostgreSQL connection.

## Health endpoint

`GET http://localhost:3000/api/health`

A successful response confirms that the API is running and that PostgreSQL can answer a query.

## Planned modules

Authentication, users, folders, files, versions, sharing, quota management, and append-only activity history will be added in stages. The versioning implementation will use a PostgreSQL transaction, a row lock on the relevant `files` record, and a unique constraint on `(file_id, version_no)`.
