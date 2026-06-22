import { DataSource } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity';

export type AccessRole = 'admin' | 'owner' | 'member';

export type AccessProfile = {
  roleCodes: string[];
  effectiveRoles: AccessRole[];
  permissions: string[];
  dataScope: {
    requirements: 'all' | 'owned' | 'assigned';
    tasks: 'all' | 'owned' | 'assigned';
    quotes: 'all' | 'none';
    settlement: 'all' | 'none';
  };
  ownedBusinessCategoryCodes: string[];
  isAdmin: boolean;
};

const adminPermissions = ['*'];

const ownerPermissions = [
  'page.requirements',
  'page.dashboard',
  'page.messages',
  'requirement.view_owned',
  'requirement.create',
  'requirement.edit_owned',
  'task.view_owned',
  'task.assign_owned',
  'task.accept_owned',
  'task.return_owned',
  'ai_preview.view_owned',
  'ai_preview.confirm_owned',
];

const memberPermissions = [
  'page.requirements',
  'page.messages',
  'task.view_assigned',
  'task.submit_assigned',
];

const categoryAliases: Record<string, string> = {
  design: 'design',
  copywriting: 'copywriting',
  operation: 'operation',
  community: 'community',
  设计: 'design',
  文案: 'copywriting',
  运营: 'operation',
  社区: 'community',
};

export function normalizeAccessBusinessCategory(value?: string | null) {
  const normalized = String(value ?? '').trim();
  return categoryAliases[normalized] ?? normalized;
}

export function hasPermission(profile: AccessProfile, permission: string) {
  return (
    profile.permissions.includes('*') || profile.permissions.includes(permission)
  );
}

export async function buildAccessProfile(
  dataSource: DataSource,
  user: Pick<UserEntity, 'id' | 'username'>,
): Promise<AccessProfile> {
  const [roleCodes, ownedBusinessCategoryCodes] = await Promise.all([
    getRoleCodes(dataSource, user.id),
    getOwnedBusinessCategoryCodes(dataSource, user.id),
  ]);
  const admin = isAdminUsername(user.username) || roleCodes.includes('admin');
  const owner =
    roleCodes.includes('owner') || ownedBusinessCategoryCodes.length > 0;

  if (admin) {
    return {
      roleCodes,
      effectiveRoles: ['admin'],
      permissions: adminPermissions,
      dataScope: {
        requirements: 'all',
        tasks: 'all',
        quotes: 'all',
        settlement: 'all',
      },
      ownedBusinessCategoryCodes,
      isAdmin: true,
    };
  }

  if (owner) {
    return {
      roleCodes,
      effectiveRoles: ['owner'],
      permissions: ownerPermissions,
      dataScope: {
        requirements: 'owned',
        tasks: 'owned',
        quotes: 'none',
        settlement: 'none',
      },
      ownedBusinessCategoryCodes,
      isAdmin: false,
    };
  }

  return {
    roleCodes,
    effectiveRoles: ['member'],
    permissions: memberPermissions,
    dataScope: {
      requirements: 'assigned',
      tasks: 'assigned',
      quotes: 'none',
      settlement: 'none',
    },
    ownedBusinessCategoryCodes,
    isAdmin: false,
  };
}

async function getRoleCodes(dataSource: DataSource, userId: string) {
  const rows: Array<{ role_code: string }> = await dataSource.query(
    `
      SELECT role.role_code
      FROM user_roles user_role
      JOIN roles role ON role.id = user_role.role_id
      WHERE user_role.user_id = ?
      ORDER BY role.role_code
    `,
    [userId],
  );
  return rows.map((row) => row.role_code);
}

async function getOwnedBusinessCategoryCodes(
  dataSource: DataSource,
  userId: string,
) {
  let rows: Array<{ business_category_code: string }> = [];
  try {
    rows = await dataSource.query(
      `
        SELECT business_category_code
        FROM business_category_owner_configs
        WHERE deleted_at IS NULL
          AND status = 'active'
          AND owner_user_id = ?
        ORDER BY business_category_code
      `,
      [userId],
    );
  } catch {
    rows = [];
  }
  return rows
    .map((row) => normalizeAccessBusinessCategory(row.business_category_code))
    .filter(Boolean);
}

function isAdminUsername(username: string) {
  if (username === 'admin') {
    return true;
  }
  return String(
    process.env.APP_ADMIN_USERNAMES ?? process.env.ADMIN_USERNAMES ?? '',
  )
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(username);
}
