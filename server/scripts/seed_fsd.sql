BEGIN;

-- 1. Create 500 clearly labelled synthetic users.
INSERT INTO users (id, full_name, email, email_normalized, password_hash)
SELECT
    md5('cloudvault-fsd-user-' || i)::uuid,
    'FSD Seed User ' || lpad(i::text, 4, '0'),
    'seed.user.' || lpad(i::text, 4, '0') || '@cloudvault.invalid',
    'seed.user.' || lpad(i::text, 4, '0') || '@cloudvault.invalid',
    '$2b$12$o8cWww2gVCDvZ5RCnHSV6uN0OxfAsK7zxv342rql6fpgNLBemfYCO'
FROM generate_series(1, 500) AS i
ON CONFLICT (email_normalized) DO NOTHING;

-- 2. Give each synthetic user a storage quota record.
INSERT INTO storage_usage (user_id)
SELECT id
FROM users
WHERE email_normalized LIKE 'seed.user.%@cloudvault.invalid'
ON CONFLICT (user_id) DO NOTHING;

-- 3. Create 1,000 folders.
INSERT INTO folders (id, owner_id, folder_name)
SELECT
    md5('cloudvault-fsd-folder-' || i)::uuid,
    (
        SELECT id FROM users
        WHERE email_normalized =
            'seed.user.' || lpad((((i - 1) % 500) + 1)::text, 4, '0')
            || '@cloudvault.invalid'
    ),
    'FSD Seed Folder ' || lpad(i::text, 4, '0')
FROM generate_series(1, 1000) AS i
ON CONFLICT (id) DO NOTHING;

-- 4. Add 1,000 folder memberships.
INSERT INTO folder_members
    (id, folder_id, user_id, role, granted_by)
SELECT
    md5('cloudvault-fsd-folder-member-' || i)::uuid,
    md5('cloudvault-fsd-folder-' || i)::uuid,
    (
        SELECT id FROM users
        WHERE email_normalized =
            'seed.user.' || lpad(((i % 500) + 1)::text, 4, '0')
            || '@cloudvault.invalid'
    ),
    'viewer',
    (
        SELECT id FROM users
        WHERE email_normalized =
            'seed.user.' || lpad((((i - 1) % 500) + 1)::text, 4, '0')
            || '@cloudvault.invalid'
    )
FROM generate_series(1, 1000) AS i
ON CONFLICT (folder_id, user_id) DO NOTHING;

-- 5. Add 500 revoked file-share history records.
WITH seed_users AS (
    SELECT id, row_number() OVER (ORDER BY email_normalized) AS rn
    FROM users
    WHERE email_normalized LIKE 'seed.user.%@cloudvault.invalid'
),
seed_files AS (
    SELECT id, owner_id, row_number() OVER (ORDER BY created_at, id) AS rn
    FROM files
)
INSERT INTO file_shares
    (id, file_id, shared_with_user_id, role, granted_by, revoked_at)
SELECT
    md5('cloudvault-fsd-file-share-' || f.id || ':' || u.id)::uuid,
    f.id,
    u.id,
    CASE WHEN u.rn % 2 = 0 THEN 'viewer' ELSE 'editor' END,
    f.owner_id,
    now()
FROM seed_files f
CROSS JOIN seed_users u
WHERE f.rn <= 5 AND u.rn <= 100
ON CONFLICT (id) DO NOTHING;

-- 6. Add 500 revoked public-link history records.
INSERT INTO share_links
    (id, file_id, token_hash, permission, created_by, revoked_at)
SELECT
    md5('cloudvault-fsd-share-link-id-' || f.id || ':' || n)::uuid,
    f.id,
    md5('cloudvault-fsd-share-link-a-' || f.id || ':' || n)
        || md5('cloudvault-fsd-share-link-b-' || f.id || ':' || n),
    CASE WHEN n % 2 = 0 THEN 'viewer' ELSE 'editor' END,
    f.owner_id,
    now()
FROM (
    SELECT id, owner_id,
           row_number() OVER (ORDER BY created_at, id) AS rn
    FROM files
) f
CROSS JOIN generate_series(1, 100) AS n
WHERE f.rn <= 5
ON CONFLICT (id) DO NOTHING;

-- 7. Add 1,000 failed upload-request test records.
INSERT INTO upload_requests
    (id, uploader_id, idempotency_key, request_payload_hash, status)
SELECT
    md5('cloudvault-fsd-upload-' || i)::uuid,
    (
        SELECT id FROM users
        WHERE email_normalized =
            'seed.user.' || lpad((((i - 1) % 500) + 1)::text, 4, '0')
            || '@cloudvault.invalid'
    ),
    'fsd-seed-upload-' || lpad(i::text, 5, '0'),
    md5('cloudvault-fsd-upload-hash-a-' || i)
        || md5('cloudvault-fsd-upload-hash-b-' || i),
    'failed'
FROM generate_series(1, 1000) AS i
ON CONFLICT (uploader_id, idempotency_key) DO NOTHING;

-- 8. Add 1,000 synthetic activity-history records.
INSERT INTO activity_logs
    (id, actor_user_id, action, metadata)
SELECT
    md5('cloudvault-fsd-activity-' || i)::uuid,
    (
        SELECT id FROM users
        WHERE email_normalized =
            'seed.user.' || lpad((((i - 1) % 500) + 1)::text, 4, '0')
            || '@cloudvault.invalid'
    ),
    'FSD_SEED_ACTIVITY',
    jsonb_build_object(
        'seed_batch', 'cloudvault_fsd_2026_11',
        'sequence', i,
        'synthetic', true
    )
FROM generate_series(1, 1000) AS i
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Report the final database row count.
SELECT
    (SELECT COUNT(*) FROM users) +
    (SELECT COUNT(*) FROM folders) +
    (SELECT COUNT(*) FROM files) +
    (SELECT COUNT(*) FROM file_versions) +
    (SELECT COUNT(*) FROM folder_members) +
    (SELECT COUNT(*) FROM file_shares) +
    (SELECT COUNT(*) FROM share_links) +
    (SELECT COUNT(*) FROM storage_usage) +
    (SELECT COUNT(*) FROM upload_requests) +
    (SELECT COUNT(*) FROM activity_logs)
    AS total_database_rows;
