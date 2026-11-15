-- Prevent duplicate active filenames within each storage location.
-- Root files are unique per owner.
-- Folder files are unique across all members of the folder.

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_root_file_name
ON files (owner_id, LOWER(BTRIM(display_name)))
WHERE folder_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_folder_file_name
ON files (folder_id, LOWER(BTRIM(display_name)))
WHERE folder_id IS NOT NULL AND deleted_at IS NULL;