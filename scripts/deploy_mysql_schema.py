import pathlib
import re

import pymysql


HOST = "rm-wz9uqix4n8s738dq18o.mysql.rds.aliyuncs.com"
PORT = 3306
USER = "bool"
PASSWORD = "v#@JrWCEH9g3"
DATABASE = "post_supplement_lib"


def load_statements(sql_path: pathlib.Path) -> list[str]:
    content = sql_path.read_text(encoding="utf-8")
    content = re.sub(
        r"CREATE DATABASE IF NOT EXISTS .*?;",
        "",
        content,
        flags=re.DOTALL,
    )
    content = re.sub(r"USE `.*?`;", "", content, flags=re.DOTALL)
    content = re.sub(r"SET NAMES .*?;", "", content, flags=re.DOTALL)
    content = re.sub(r"SET FOREIGN_KEY_CHECKS = \d+;", "", content, flags=re.DOTALL)
    content = re.sub(r"DROP TABLE IF EXISTS `.*?`;", "", content, flags=re.DOTALL)
    lines = []
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("--"):
            continue
        lines.append(line)

    filtered = "\n".join(lines)
    filtered = re.sub(r"CREATE TABLE `", "CREATE TABLE IF NOT EXISTS `", filtered)
    statements = [stmt.strip() for stmt in filtered.split(";") if stmt.strip()]
    return statements


def main() -> None:
    root = pathlib.Path(__file__).resolve().parents[1]
    sql_path = root / "mysql_schema.sql"
    statements = load_statements(sql_path)

    conn = pymysql.connect(
        host=HOST,
        port=PORT,
        user=USER,
        password=PASSWORD,
        database=DATABASE,
        charset="utf8mb4",
        autocommit=True,
    )

    executed = 0
    try:
        with conn.cursor() as cur:
            for stmt in statements:
                cur.execute(stmt)
                executed += 1

            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = %s
                  AND table_name IN (
                    'users', 'roles', 'user_roles', 'customers', 'projects',
                    'project_members', 'requirements', 'requirement_versions',
                    'requirement_items', 'tasks', 'worklogs', 'risk_alerts',
                    'ai_execution_logs', 'weekly_reports', 'quotations',
                    'quotation_items', 'change_requests', 'change_request_items',
                    'requirement_quotation_mappings', 'feishu_object_links',
                    'feishu_sync_logs', 'ai_suggestion_actions', 'audit_logs'
                  )
                ORDER BY table_name
                """,
                (DATABASE,),
            )
            tables = [row[0] for row in cur.fetchall()]

        print(f"executed_statements={executed}")
        print(f"created_or_verified_tables={len(tables)}")
        for name in tables:
            print(name)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
