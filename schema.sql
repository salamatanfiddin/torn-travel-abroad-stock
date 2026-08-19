CREATE TABLE IF NOT EXISTS stock_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER NOT NULL,
  item_name     TEXT NOT NULL,
  country       TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  cost          INTEGER NOT NULL,
  source_update INTEGER NOT NULL,   -- unix timestamp YATA says this country's data was last updated
  fetched_at    INTEGER NOT NULL,   -- unix timestamp our worker actually saw this row
  UNIQUE(item_id, country, source_update)
);

CREATE INDEX IF NOT EXISTS idx_stock_log_item ON stock_log(item_name);
CREATE INDEX IF NOT EXISTS idx_stock_log_country ON stock_log(country);
CREATE INDEX IF NOT EXISTS idx_stock_log_fetched ON stock_log(fetched_at);
