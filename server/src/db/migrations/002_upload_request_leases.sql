-- CLOUDVAULT: Upload request lease and fencing token
-- Safe additive migration. Does not modify existing file versions.

ALTER TABLE upload_requests
ADD COLUMN IF NOT EXISTS attempt_token UUID;

ALTER TABLE upload_requests
ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

-- Give existing pending requests a token and a lease based on creation time.
UPDATE upload_requests
SET
    attempt_token = COALESCE(attempt_token, gen_random_uuid()),
    lease_expires_at = COALESCE(
        lease_expires_at,
        created_at + INTERVAL '15 minutes'
    )
WHERE status = 'pending';

-- Helps locate expired pending upload requests efficiently.
CREATE INDEX IF NOT EXISTS idx_upload_requests_pending_lease
ON upload_requests (lease_expires_at)
WHERE status = 'pending';
