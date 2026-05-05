---
description: Run an ad-hoc DuckDB query against the golf analytics database and display results. Usage: /db-query <SQL or natural language question>
---

Run a query against the golf analytics DuckDB database at `db/golf_analytics.duckdb`.

Query or question: $ARGUMENTS

Steps:
1. If the input is a natural language question (not SQL), first read `db/schema.sql` to understand the schema, then translate it to a SQL query.
2. Run the query using: `.venv/bin/python -c "import duckdb; conn = duckdb.connect('db/golf_analytics.duckdb', read_only=True); print(conn.execute('''<SQL>''').df().to_string())"`
3. Display the results in a readable format. If there are more than 20 rows, show the first 20 and summarize the rest.
4. If the query fails, diagnose the error, fix the SQL, and retry once.

Always open the connection read-only. Never run INSERT, UPDATE, DELETE, or DDL statements through this skill — those go through the ingester or a schema migration.
