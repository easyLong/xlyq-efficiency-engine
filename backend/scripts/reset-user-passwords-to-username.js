const mysql = require('mysql2/promise');
require('dotenv').config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const missingOnly = process.argv.includes('--missing-only');
  const connection = await mysql.createConnection({
    host: requireEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requireEnv('DB_USER'),
    password: process.env.DB_PASSWORD || '',
    database: requireEnv('DB_NAME'),
    multipleStatements: false,
  });

  try {
    const [users] = await connection.query(
      `
        SELECT id, username, display_name
        FROM users
        WHERE status = 'active'
          AND username IS NOT NULL
          AND username <> ''
          ${missingOnly ? 'AND passwd IS NULL' : ''}
      `,
    );

    if (dryRun) {
      console.log(
        `Would reset ${users.length} active user password(s) to their username.`,
      );
      return;
    }

    for (const user of users) {
      await connection.execute(
        `
          UPDATE users
          SET passwd = ?,
              password_hash = NULL,
              password_updated_at = NOW(),
              updated_at = NOW()
          WHERE id = ?
        `,
        [user.username, user.id],
      );
    }

    console.log(`Reset ${users.length} active user password(s) to username.`);
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
