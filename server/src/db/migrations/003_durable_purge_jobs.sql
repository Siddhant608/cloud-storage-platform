
-- CLOUDVAULT: Durable permanent purge jobs
-- Keeps a durable record of blobs requiring physical cleanup.

CREATE TABLE IF NOT EXISTS file_purge_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    file_id UUID NOT NULL UNIQUE
        REFERENCES files(id) ON DELETE RESTRICT,

    owner_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    blob_keys JSONB NOT NULL DEFAULT '[]'::jsonb,

    total_bytes BIGINT NOT NULL DEFAULT 0
        CHECK (total_bytes >= 0),

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_file_purge_jobs_pending
ON file_purge_jobs(created_at)
WHERE status = 'pending';
