use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_snippets_table",
        sql: "CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            pinned INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_snippets_title ON snippets (title);
        CREATE INDEX IF NOT EXISTS idx_snippets_pinned ON snippets (pinned);
        CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets (created_at);
        CREATE INDEX IF NOT EXISTS idx_snippets_updated_at ON snippets (updated_at);",
        kind: MigrationKind::Up,
    }, Migration {
        version: 2,
        description: "upgrade_snippets_schema",
        sql: "ALTER TABLE snippets ADD COLUMN description TEXT;
        ALTER TABLE snippets ADD COLUMN category TEXT NOT NULL DEFAULT 'Personal';
        ALTER TABLE snippets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE snippets ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE snippets ADD COLUMN last_used TEXT;
        DROP INDEX IF EXISTS idx_snippets_pinned;
        ALTER TABLE snippets DROP COLUMN pinned;
        CREATE INDEX IF NOT EXISTS idx_snippets_category ON snippets (category);
        CREATE INDEX IF NOT EXISTS idx_snippets_favorite ON snippets (favorite);
        CREATE INDEX IF NOT EXISTS idx_snippets_usage_count ON snippets (usage_count);",
        kind: MigrationKind::Up,
    }]
}
