import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE composer_storage_entries (
      session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      thread_id TEXT,
      snippet TEXT NOT NULL,
      attachment_count INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      content_json TEXT NOT NULL,
      PRIMARY KEY (session_id, client_id, scope_key, entry_id)
    )
  `;
  yield* sql`CREATE INDEX composer_storage_thread_idx ON composer_storage_entries(thread_id)`;
  yield* sql`
    CREATE TABLE composer_storage_files (
      session_id TEXT NOT NULL REFERENCES auth_sessions(session_id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      PRIMARY KEY (session_id, client_id, attachment_id)
    )
  `;
});
