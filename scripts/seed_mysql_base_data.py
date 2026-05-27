import pymysql


HOST = "rm-wz9uqix4n8s738dq18o.mysql.rds.aliyuncs.com"
PORT = 3306
USER = "bool"
PASSWORD = "v#@JrWCEH9g3"
DATABASE = "post_supplement_lib"


ROLES = [
    ("11111111-1111-1111-1111-111111111111", "admin", "系统管理员", "系统管理"),
    ("22222222-2222-2222-2222-222222222222", "pm", "项目经理", "项目推进与需求管理"),
    ("33333333-3333-3333-3333-333333333333", "member", "执行员工", "任务执行"),
    ("44444444-4444-4444-4444-444444444444", "manager", "管理者", "全局监控与经营分析"),
    ("55555555-5555-5555-5555-555555555555", "finance", "财务", "报价与结算"),
    ("66666666-6666-6666-6666-666666666666", "customer", "客户", "需求确认与报价查看"),
]


def main() -> None:
    conn = pymysql.connect(
        host=HOST,
        port=PORT,
        user=USER,
        password=PASSWORD,
        database=DATABASE,
        charset="utf8mb4",
        autocommit=True,
    )

    try:
        with conn.cursor() as cur:
            for role_id, role_code, role_name, remark in ROLES:
                cur.execute(
                    """
                    INSERT INTO roles (id, role_code, role_name, remark, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE
                      role_name = VALUES(role_name),
                      remark = VALUES(remark),
                      updated_at = NOW()
                    """,
                    (role_id, role_code, role_name, remark),
                )

            cur.execute("SELECT role_code, role_name FROM roles ORDER BY role_code")
            for row in cur.fetchall():
                print(f"{row[0]} => {row[1]}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
