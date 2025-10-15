-- Minimal init för cache + healthcheck
CREATE TABLE IF NOT EXISTS tts_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voice TEXT NOT NULL,
  phrase TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tts_cache_voice ON tts_cache(voice);
CREATE INDEX IF NOT EXISTS idx_tts_cache_hash ON tts_cache(hash);
