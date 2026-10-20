"""SQL guard: every DataDesk failure from ROADMAP section 4 is a regression test here."""

import pytest

from app.query.sqlguard import GuardError, bind_params, check_sql

ALL = ("mysql", "postgresql", "mssql", "sqlite")


def ok(sql, dialect="mysql", **kw):
    return check_sql(sql, dialect, **kw)


def bad(sql, dialect="mysql", match=None, **kw):
    with pytest.raises(GuardError, match=match):
        check_sql(sql, dialect, **kw)


# ---------------------------------------------------------------- DataDesk regressions (ROADMAP 4.1)

def test_datadesk_load_file_and_sleep_are_rejected():
    bad("SELECT LOAD_FILE('/etc/passwd')", match="LOAD_FILE")
    bad("SELECT SLEEP(25)", match="SLEEP")
    bad("select load_file(0x2f6574632f706173737764)", match="LOAD_FILE")


def test_datadesk_false_positives_are_accepted():
    ok("SELECT REPLACE(name, 'a', 'b') FROM customers")
    ok("SELECT * FROM notes WHERE body = 'please update the order'")
    ok("SELECT `set`, `update`, `delete` FROM t")
    ok('SELECT "set" FROM t', "postgresql")
    ok("SELECT [set] FROM [dbo].[t]", "mssql")


def test_datadesk_hash_inside_a_literal_is_kept():
    assert ok("SELECT '#fff' AS colour").sql == "SELECT '#fff' AS colour"  # executed unchanged


# ---------------------------------------------------------------- what is allowed

@pytest.mark.parametrize("dialect", ALL)
def test_plain_reads(dialect):
    ok("SELECT 1", dialect)
    ok("SELECT a, count(*) FROM t GROUP BY a HAVING count(*) > 1 ORDER BY 2 DESC", dialect)
    ok("WITH x AS (SELECT a FROM t) SELECT * FROM x", dialect)
    ok("SELECT a FROM t UNION SELECT a FROM u", dialect)
    ok("SELECT * FROM t -- trailing comment\n", dialect)
    ok("(SELECT 1)", dialect)


def test_dialect_specific_reads():
    ok("SELECT x::date, $$text$$ FROM t", "postgresql")
    ok("SELECT TOP 10 * FROM t WITH (NOLOCK) ORDER BY a", "mssql")
    ok("SELECT * FROM t LIMIT 5 # mysql comment\n", "mysql")
    ok("SELECT 'it''s', 'a\\'b' FROM t", "mysql")


def test_tables_are_reported():
    assert ok("SELECT * FROM a JOIN s.b ON 1=1").tables == ["a", "s.b"]
    assert ok("WITH c AS (SELECT 1) SELECT * FROM c").tables == []


# ---------------------------------------------------------------- what is rejected

@pytest.mark.parametrize(
    "sql, dialect",
    [
        ("DELETE FROM t", "mysql"),
        ("UPDATE t SET a = 1", "postgresql"),
        ("INSERT INTO t VALUES (1)", "mssql"),
        ("DROP TABLE t", "sqlite"),
        ("CREATE TABLE x (a int)", "postgresql"),
        ("TRUNCATE TABLE t", "mysql"),
        ("SET @a = 1", "mysql"),
        ("SHOW TABLES", "mysql"),
        ("CALL p()", "mysql"),
        ("EXEC xp_cmdshell 'dir'", "mssql"),
        ("DECLARE @a INT", "mssql"),
        ("PRAGMA table_info(t)", "sqlite"),
        ("ATTACH DATABASE 'x' AS y", "sqlite"),
        ("COPY t TO '/tmp/x'", "postgresql"),
        ("EXPLAIN ANALYZE DELETE FROM t", "postgresql"),
        ("VALUES (1)", "postgresql"),
    ],
)
def test_non_select_statements(sql, dialect):
    bad(sql, dialect)


def test_one_statement_only():
    bad("SELECT 1; DROP TABLE t", match="one statement")
    bad("SELECT 1; SELECT 2", "postgresql", match="one statement")
    ok("SELECT 1;")


def test_writes_hidden_in_a_cte():
    bad("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", "postgresql", match="DELETE")


def test_select_into_and_locks():
    bad("SELECT * INTO newt FROM t", "postgresql", match="INTO")
    bad("SELECT * INTO #t FROM t", "mssql", match="INTO")
    bad("SELECT * FROM t INTO OUTFILE '/tmp/x'", "mysql")
    bad("SELECT * FROM t FOR UPDATE", "mysql", match="locking")
    bad("SELECT * FROM t LOCK IN SHARE MODE", "mysql", match="locking")
    bad("SELECT * FROM t FOR SHARE", "postgresql", match="locking")
    bad("SELECT * FROM t WITH (UPDLOCK)", "mssql", match="UPDLOCK")


@pytest.mark.parametrize(
    "sql, dialect",
    [
        ("SELECT pg_sleep(10)", "postgresql"),
        ("SELECT pg_catalog.pg_sleep(1)", "postgresql"),
        ('SELECT "pg_sleep"(1)', "postgresql"),
        ("SELECT pg_read_file('/etc/passwd')", "postgresql"),
        ("SELECT lo_import('/etc/passwd')", "postgresql"),
        ("SELECT set_config('a', 'b', false)", "postgresql"),
        ("SELECT * FROM dblink('host=x', 'SELECT 1') AS t(a int)", "postgresql"),
        ("SELECT BENCHMARK(1000000, MD5('a'))", "mysql"),
        ("SELECT GET_LOCK('a', 10)", "mysql"),
        ("SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')", "mssql"),
        ("SELECT * FROM OPENQUERY(srv, 'SELECT 1')", "mssql"),
        ("SELECT load_extension('x')", "sqlite"),
        ("SELECT readfile('/etc/passwd')", "sqlite"),
    ],
)
def test_denied_functions(sql, dialect):
    bad(sql, dialect, match="not allowed")


def test_mysql_comment_tricks():
    # sqlglot would see "SELECT 1" + a comment; MySQL sees 1 - -1, LOAD_FILE(...)
    bad("SELECT 1 --1, LOAD_FILE('/etc/passwd')", match="needs a space")
    bad("/*! DROP TABLE t */ SELECT 1", match="executable comments")
    bad("SELECT 1 /*M! , SLEEP(5) */", match="executable comments")
    ok("SELECT 1 -- fine\n, 2")
    ok("SELECT 'a--b', \"c--d\", `e--f` FROM t")
    ok("SELECT 1 /*+ MAX_EXECUTION_TIME(1000) */")
    bad("SELECT 'unterminated", match="not closed")


def test_system_catalogs_need_admin():
    bad("SELECT * FROM information_schema.tables", match="administrators")
    bad("SELECT * FROM pg_catalog.pg_user", "postgresql", match="administrators")
    bad("SELECT * FROM pg_shadow", "postgresql", match="administrators")
    bad("SELECT * FROM mysql.user", match="administrators")
    bad("SELECT * FROM sys.objects", "mssql", match="administrators")
    bad("SELECT * FROM master.dbo.sysdatabases", "mssql", match="administrators")
    bad("SELECT name FROM sqlite_master", "sqlite", match="administrators")
    ok("SELECT * FROM information_schema.tables", allow_system=True)


def test_garbage_and_limits():
    bad("", match="SELECT")
    bad("   ", match="SELECT")
    bad("SELEC 1", match="Could not read")
    bad("SELECT 1" + " " * 100_001, match="longer")


# ---------------------------------------------------------------- parameters

def test_params_are_found_and_checked_as_values():
    checked = ok("SELECT * FROM t WHERE region = {{region}} AND total > {{ min_total }} OR region = {{region}}")
    assert checked.params == ["region", "min_total"]


def test_bind_params_per_driver_style():
    sql = "SELECT * FROM t WHERE a LIKE 'x%' AND b = {{b}} AND c = {{c}} AND d = {{b}}"
    text, params = bind_params(sql, {"b": "B", "c": 2}, "pyformat")
    assert text == "SELECT * FROM t WHERE a LIKE 'x%%' AND b = %(p_b)s AND c = %(p_c)s AND d = %(p_b)s"
    assert params == {"p_b": "B", "p_c": 2}
    text, params = bind_params(sql, {"b": "B", "c": 2}, "qmark")
    assert text == "SELECT * FROM t WHERE a LIKE 'x%' AND b = ? AND c = ? AND d = ?" and params == ("B", 2, "B")
    with pytest.raises(GuardError, match="c"):
        bind_params(sql, {"b": 1}, "qmark")
    with pytest.raises(GuardError, match="must be text"):
        bind_params("SELECT {{x}}", {"x": [1, 2]}, "qmark")
