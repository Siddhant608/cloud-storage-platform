
-- ============================================
-- CLOUDVAULT: INITIAL DATABASE SCHEMA
-- PostgreSQL 18
-- ============================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    email_normalized VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. FOLDERS
CREATE TABLE IF NOT EXISTS folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    parent_folder_id UUID REFERENCES folders(id),
    folder_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (LENGTH(TRIM(folder_name)) > 0)
);

-- 3. FILES
CREATE TABLE IF NOT EXISTS files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    folder_id UUID REFERENCES folders(id) ON DELETE SET NULL,
    display_name VARCHAR(255) NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (LENGTH(TRIM(display_name)) > 0)
);

-- 4. FILE VERSIONS
CREATE TABLE IF NOT EXISTS file_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
    version_no INTEGER NOT NULL CHECK (version_no > 0),
    uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    blob_key TEXT NOT NULL UNIQUE,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    checksum_sha256 VARCHAR(64) NOT NULL,
    content_type VARCHAR(255),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_file_version
        UNIQUE (file_id, version_no)
);

-- 5. FOLDER MEMBERS
CREATE TABLE IF NOT EXISTS folder_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id UUID NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('viewer', 'editor')),
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (folder_id, user_id)
);

-- 6. FILE SHARES
CREATE TABLE IF NOT EXISTS file_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id),
    shared_with_user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(20) NOT NULL CHECK (role IN ('viewer', 'editor')),
    granted_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_file_share
ON file_shares(file_id, shared_with_user_id)
WHERE revoked_at IS NULL;

-- 7. SHARE LINKS
CREATE TABLE IF NOT EXISTS share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id UUID NOT NULL REFERENCES files(id),
    token_hash TEXT NOT NULL UNIQUE,
    permission VARCHAR(20) NOT NULL DEFAULT 'viewer'
        CHECK (permission IN ('viewer', 'editor')),
    created_by UUID NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. STORAGE USAGE
CREATE TABLE IF NOT EXISTS storage_usage (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    quota_bytes BIGINT NOT NULL DEFAULT 524288000
        CHECK (quota_bytes >= 0),
    used_bytes BIGINT NOT NULL DEFAULT 0
        CHECK (used_bytes >= 0),
    reserved_bytes BIGINT NOT NULL DEFAULT 0
        CHECK (reserved_bytes >= 0),

    CHECK (used_bytes + reserved_bytes <= quota_bytes)
);

-- 9. UPLOAD REQUESTS (IDEMPOTENCY)
CREATE TABLE IF NOT EXISTS upload_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id UUID NOT NULL REFERENCES users(id),
    idempotency_key VARCHAR(255) NOT NULL,
    request_payload_hash VARCHAR(64),
    file_id UUID REFERENCES files(id),
    version_id UUID REFERENCES file_versions(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (uploader_id, idempotency_key)
);

-- 10. ACTIVITY LOGS
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    file_id UUID REFERENCES files(id) ON DELETE SET NULL,
    version_id UUID REFERENCES file_versions(id) ON DELETE SET NULL,
    request_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_files_owner
ON files(owner_id);

CREATE INDEX IF NOT EXISTS idx_files_folder
ON files(folder_id);

CREATE INDEX IF NOT EXISTS idx_folders_owner
ON folders(owner_id);

CREATE INDEX IF NOT EXISTS idx_file_versions_history
ON file_versions(file_id, version_no DESC);

CREATE INDEX IF NOT EXISTS idx_file_versions_uploaded
ON file_versions(file_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_file
ON activity_logs(file_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_actor
ON activity_logs(actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_folder_members_user
ON folder_members(user_id);

-- ============================================
-- PROTECT VERSION AND ACTIVITY HISTORY
-- ============================================

CREATE OR REPLACE FUNCTION prevent_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'Historical records cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS protect_file_versions ON file_versions;

CREATE TRIGGER protect_file_versions
BEFORE UPDATE OR DELETE ON file_versions
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();

DROP TRIGGER IF EXISTS protect_activity_logs ON activity_logs;

CREATE TRIGGER protect_activity_logs
BEFORE UPDATE OR DELETE ON activity_logs
FOR EACH ROW EXECUTE FUNCTION prevent_history_mutation();
