CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    received_at INTEGER NOT NULL,
    event_date TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_name TEXT NOT NULL,
    feature TEXT,
    app_version TEXT NOT NULL,
    display_mode TEXT NOT NULL,
    platform TEXT NOT NULL,
    browser TEXT NOT NULL,
    country TEXT NOT NULL,
    was_online INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_received_at ON analytics_events(received_at);
CREATE INDEX IF NOT EXISTS idx_analytics_event_date ON analytics_events(event_date);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON analytics_events(event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_visitor ON analytics_events(visitor_id);

