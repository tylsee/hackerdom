# Mac test failures — fixture fixes (2026-10-10)

These changes address two **test-fixture issues** reported from a Mac:

1. `test/database.test.js`: The test creates a v1 SQLite database using raw `better-sqlite3`, which may leave the file with mode `0644` (depending on umask). `openDatabase()` rightly rejects existing group/world-readable databases. After creating and closing the legacy fixture, the test now calls `chmodSync(path, 0o600)` on POSIX **before** invoking the secure database opener. The strict permission check remains unchanged. Real databases must continue to have private permissions.
2. `test/server.test.js`: A socket containing only incomplete HTTP headers is not reliably considered an active request. Node may close it during `server.close()` / `closeIdleConnections()` and return a clean shutdown. The test now opens a test-only server whose handler writes part of a response and intentionally leaves it unfinished, then verifies the shutdown timer forcibly closes that genuinely active connection.

No API endpoints, database migrations, application behavior, or security checks were modified.

## Validation performed

- `npm run check` and syntax checks for all six JS test files: passed with Node 22.16.0.
- Native Node HTTP test of the active-response shutdown setup: forced timeout returned false as expected.
- The original migration SQL was independently checked with Python SQLite using a populated v1 database: data, foreign-key integrity, and schema matched the expected v2 layout (this is not a substitute for the native better-sqlite3 test).
- Complete Vitest run is **not verified in this container** because npm dependencies could not be fully installed.

## Run on Mac

```bash
npm ci
npm run check
npm test
```

Expected after these two test-only fixes: all 133 tests pass (verify on your machine; not independently asserted here).

Do not delete the existing SQLite database or weaken the `0600` permission check to make tests pass.
