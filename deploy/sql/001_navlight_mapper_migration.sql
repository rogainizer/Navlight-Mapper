-- Navlight Mapper production migration script
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS sync_batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id VARCHAR(64) NOT NULL,
  client_id VARCHAR(64) NOT NULL,
  status ENUM('processing', 'completed', 'failed') NOT NULL,
  point_count INT NOT NULL DEFAULT 0,
  photo_count INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sync_batch (batch_id, client_id)
);

CREATE TABLE IF NOT EXISTS tracks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  local_id VARCHAR(64) NOT NULL,
  map_local_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tracks_local_id (local_id)
);

CREATE TABLE IF NOT EXISTS track_points (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  local_id VARCHAR(64) NOT NULL,
  track_local_id VARCHAR(64) NOT NULL,
  map_local_id VARCHAR(64) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy FLOAT NOT NULL,
  recorded_at DATETIME NOT NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_track_points_local_id (local_id),
  INDEX idx_track_points_track_local_id (track_local_id),
  INDEX idx_track_points_map_local_id (map_local_id),
  INDEX idx_track_points_recorded_at (recorded_at)
);

CREATE TABLE IF NOT EXISTS photos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  local_id VARCHAR(64) NOT NULL,
  track_local_id VARCHAR(64) NULL,
  map_local_id VARCHAR(64) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy FLOAT NOT NULL,
  captured_at DATETIME NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size BIGINT NOT NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_photos_local_id (local_id),
  INDEX idx_photos_track_local_id (track_local_id),
  INDEX idx_photos_map_local_id (map_local_id),
  INDEX idx_photos_captured_at (captured_at)
);

CREATE TABLE IF NOT EXISTS comments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  local_id VARCHAR(64) NOT NULL,
  track_local_id VARCHAR(64) NULL,
  map_local_id VARCHAR(64) NOT NULL,
  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  accuracy FLOAT NOT NULL,
  comment_text TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_comments_local_id (local_id),
  INDEX idx_comments_track_local_id (track_local_id),
  INDEX idx_comments_map_local_id (map_local_id),
  INDEX idx_comments_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS maps (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  local_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  image_blob LONGBLOB NOT NULL,
  calibration_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_maps_local_id (local_id),
  INDEX idx_maps_updated_at (updated_at)
);

CREATE TABLE IF NOT EXISTS routes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  local_id VARCHAR(64) NOT NULL,
  map_local_id VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  color_hex VARCHAR(7) NOT NULL,
  points_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_routes_local_id (local_id),
  INDEX idx_routes_map_local_id (map_local_id),
  INDEX idx_routes_created_at (created_at)
);

-- Add fields for older deployments where table exists without these columns.
SET @current_db = DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @current_db
        AND TABLE_NAME = 'maps'
        AND COLUMN_NAME = 'calibration_json'
    ),
    'SELECT 1',
    'ALTER TABLE maps ADD COLUMN calibration_json LONGTEXT NULL'
  )
);
PREPARE migration_stmt FROM @sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @current_db
        AND TABLE_NAME = 'sync_batches'
        AND COLUMN_NAME = 'point_count'
    ),
    'SELECT 1',
    'ALTER TABLE sync_batches ADD COLUMN point_count INT NOT NULL DEFAULT 0'
  )
);
PREPARE migration_stmt FROM @sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @current_db
        AND TABLE_NAME = 'sync_batches'
        AND COLUMN_NAME = 'photo_count'
    ),
    'SELECT 1',
    'ALTER TABLE sync_batches ADD COLUMN photo_count INT NOT NULL DEFAULT 0'
  )
);
PREPARE migration_stmt FROM @sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;

SET @sql := (
  SELECT IF(
    EXISTS (
      SELECT 1
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @current_db
        AND TABLE_NAME = 'sync_batches'
        AND COLUMN_NAME = 'error_message'
    ),
    'SELECT 1',
    'ALTER TABLE sync_batches ADD COLUMN error_message TEXT NULL'
  )
);
PREPARE migration_stmt FROM @sql;
EXECUTE migration_stmt;
DEALLOCATE PREPARE migration_stmt;
