import os

import pymysql


HOST = os.getenv("DB_HOST", "127.0.0.1")
PORT = int(os.getenv("DB_PORT", "3306"))
USER = os.getenv("DB_USER", "root")
PASSWORD = os.getenv("DB_PASSWORD", "")
DATABASE = os.getenv("DB_NAME", "xlyq_efficiency_engine")


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
            user_id = "7f9a1c9d-4d62-4a8f-8d71-5f8b9bb0e101"
            customer_id = "89b2a85b-0bc8-4d0a-9bc0-35df9c86a201"
            project_id = "94d9b8f4-6e0a-4e1d-8f9d-f3d2f0f7a301"

            cur.execute(
                """
                INSERT INTO users (
                  id, username, display_name, email, mobile, avatar_url,
                  status, source, feishu_open_id, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'active', 'local', NULL, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                  display_name = VALUES(display_name),
                  email = VALUES(email),
                  mobile = VALUES(mobile),
                  updated_at = NOW()
                """,
                (
                    user_id,
                    "demo.pm.v2",
                    "演示项目经理",
                    "demo.pm@example.com",
                    "13800000000",
                    None,
                ),
            )

            cur.execute(
                """
                INSERT INTO user_roles (id, user_id, role_id, created_at)
                VALUES (%s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE created_at = created_at
                """,
                (
                    "aaaaaaa1-1111-1111-1111-111111111111",
                    user_id,
                    "22222222-2222-2222-2222-222222222222",
                ),
            )

            cur.execute(
                """
                INSERT INTO customers (
                  id, customer_code, customer_name, contact_name, contact_mobile,
                  contact_email, industry, source, status, remark, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, 'seed', 'active', %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                  customer_name = VALUES(customer_name),
                  contact_name = VALUES(contact_name),
                  contact_mobile = VALUES(contact_mobile),
                  contact_email = VALUES(contact_email),
                  industry = VALUES(industry),
                  updated_at = NOW()
                """,
                (
                    customer_id,
                    "CUST-DEMO-002",
                    "演示客户",
                    "张总",
                    "13900000000",
                    "demo.customer@example.com",
                    "互联网",
                    "效能引擎联调演示客户",
                ),
            )

            cur.execute(
                """
                INSERT INTO projects (
                  id, project_code, project_name, customer_id, owner_user_id,
                  project_type, status, priority, budget_amount, start_date,
                  planned_end_date, actual_end_date, description, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, 'in_progress', 'high', %s, CURDATE(),
                        DATE_ADD(CURDATE(), INTERVAL 30 DAY), NULL, %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                  project_name = VALUES(project_name),
                  customer_id = VALUES(customer_id),
                  owner_user_id = VALUES(owner_user_id),
                  updated_at = NOW()
                """,
                (
                    project_id,
                    "PRJ-DEMO-002",
                    "效能引擎演示项目",
                    customer_id,
                    user_id,
                    "software",
                    "98000.00",
                    "用于需求、任务、报价联调的演示项目",
                ),
            )

            cur.execute(
                """
                INSERT INTO project_members (id, project_id, user_id, member_role, joined_at, created_at)
                VALUES (%s, %s, %s, 'pm', NOW(), NOW())
                ON DUPLICATE KEY UPDATE joined_at = joined_at
                """,
                (
                    "bbbbbbb2-2222-2222-2222-222222222222",
                    project_id,
                    user_id,
                ),
            )

            print("seeded_user_id=", user_id)
            print("seeded_customer_id=", customer_id)
            print("seeded_project_id=", project_id)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
