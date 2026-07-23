import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { buildAccessProfile } from '../common/access-control';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RoleEntity } from './entities/role.entity';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly rolesRepository: Repository<RoleEntity>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureUsersAuthSchema();
    await this.initializePasswords();
  }

  async findAll() {
    const users = await this.usersRepository.find({
      order: { created_at: 'DESC' },
      take: 50,
    });
    return this.attachRoleCodes(users);
  }

  async findLoginUsers() {
    const users = await this.usersRepository.find({
      where: { status: 'active' },
      order: { created_at: 'DESC' },
      take: 50,
    });
    const visibleUsers = await this.filterLoginVisibleUsers(users);
    return visibleUsers.map((user) => ({
      username: user.username,
      display_name: user.display_name,
      source: user.source,
    }));
  }

  async login(dto: LoginDto) {
    if (!this.isDevLoginEnabled(dto.loginKey)) {
      throw new UnauthorizedException('Emergency user login is disabled');
    }
    const user = await this.usersRepository.findOne({
      where: { username: dto.username, status: 'active' },
    });
    if (!user) {
      throw new NotFoundException('Active user not found');
    }

    return {
      accessToken: `mvp-${user.id}`,
      tokenType: 'MVP',
      user: await this.attachRoleCodesToUser(user),
    };
  }

  getLoginConfig() {
    return {
      passwordLoginEnabled: true,
      emergencyLoginEnabled: this.isEmergencyLoginVisible(),
    };
  }

  async loginWithPassword(dto: PasswordLoginDto) {
    const account = dto.account.trim();
    const user = await this.findUserByAccount(account);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid account or password');
    }
    if (!(await this.canUsePasswordLogin(user))) {
      throw new UnauthorizedException('Account is not enabled for login');
    }
    if (!user.passwd && !user.password_hash) {
      throw new UnauthorizedException(
        'Password is not configured for this account',
      );
    }
    const passwordMatched = user.passwd
      ? dto.password === user.passwd
      : Boolean(
          user.password_hash &&
            this.verifyPassword(dto.password, user.password_hash),
        );
    if (!passwordMatched) {
      throw new UnauthorizedException('Invalid account or password');
    }

    user.last_login_at = new Date();
    const saved = await this.usersRepository.save(user);
    return {
      accessToken: `mvp-${saved.id}`,
      tokenType: 'MVP',
      user: await this.attachRoleCodesToUser(saved),
    };
  }

  async findRoles() {
    return this.rolesRepository.find({
      order: { role_code: 'ASC' },
    });
  }

  async findOne(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.attachRoleCodesToUser(user);
  }

  async create(dto: CreateUserDto) {
    const existing = await this.usersRepository.findOne({
      where: { username: dto.username },
    });
    if (existing) {
      throw new ConflictException('Username already exists');
    }

    const user = this.usersRepository.create({
      id: randomUUID(),
      username: dto.username,
      display_name: dto.displayName,
      login_enabled: dto.loginEnabled ?? false,
      email: dto.email ?? null,
      mobile: dto.mobile ?? null,
      avatar_url: dto.avatarUrl ?? null,
      status: 'active',
      source: dto.source ?? 'local',
      feishu_open_id: dto.feishuOpenId ?? null,
      passwd: dto.password ?? dto.username,
      password_hash: null,
      password_updated_at: new Date(),
    });
    return this.usersRepository.save(user);
  }

  async update(userId: string, dto: UpdateUserDto) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    Object.assign(user, {
      display_name: dto.displayName ?? user.display_name,
      email: dto.email ?? user.email,
      mobile: dto.mobile ?? user.mobile,
      avatar_url: dto.avatarUrl ?? user.avatar_url,
      status: dto.status ?? user.status,
      feishu_open_id: dto.feishuOpenId ?? user.feishu_open_id,
      login_enabled: dto.loginEnabled ?? user.login_enabled,
    });
    if (dto.password) {
      user.passwd = dto.password;
      user.password_hash = null;
      user.password_updated_at = new Date();
    }
    return this.usersRepository.save(user);
  }

  private isDevLoginEnabled(loginKey?: string) {
    if (this.configService.get<string>('ALLOW_DEV_LOGIN') === 'true') {
      return true;
    }
    const expectedKey = this.configService.get<string>('DEV_LOGIN_KEY');
    return Boolean(expectedKey && loginKey && expectedKey === loginKey);
  }

  private isEmergencyLoginVisible() {
    return (
      this.configService.get<string>('ALLOW_DEV_LOGIN') === 'true' ||
      Boolean(this.configService.get<string>('DEV_LOGIN_KEY'))
    );
  }

  private async findUserByAccount(account: string) {
    const byDisplayName = await this.usersRepository.findOne({
      where: { display_name: account, status: 'active' },
    });
    if (byDisplayName) return byDisplayName;
    const byUsername = await this.usersRepository.findOne({
      where: { username: account, status: 'active' },
    });
    if (byUsername) return byUsername;
    const byEmail = await this.usersRepository.findOne({
      where: { email: account, status: 'active' },
    });
    if (byEmail) return byEmail;
    return this.usersRepository.findOne({
      where: { mobile: account, status: 'active' },
    });
  }

  private async filterLoginVisibleUsers(users: UserEntity[]) {
    const checks = await Promise.all(
      users.map(async (user) => ({
        user,
        visible: await this.canUsePasswordLogin(user),
      })),
    );
    return checks.filter((item) => item.visible).map((item) => item.user);
  }

  private async canUsePasswordLogin(user: UserEntity) {
    if (user.login_enabled) {
      return true;
    }
    const profile = await buildAccessProfile(this.dataSource, user);
    return (
      profile.isAdmin ||
      profile.effectiveRoles.some((role) => role !== 'member')
    );
  }

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
  }

  private verifyPassword(password: string, storedHash: string) {
    const [scheme, salt, hash] = storedHash.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) {
      return false;
    }
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  }

  private async initializePasswords() {
    const initialUserPassword =
      this.configService.get<string>('INITIAL_USER_PASSWORD');
    if (initialUserPassword) {
      const users = await this.usersRepository.find({
        where: { passwd: IsNull(), status: 'active' },
      });
      for (const user of users) {
        user.passwd = initialUserPassword;
        user.password_hash = null;
        user.password_updated_at = new Date();
        await this.usersRepository.save(user);
      }
      return;
    }

    const activeUsersWithoutPassword = await this.usersRepository.find({
      where: { passwd: IsNull(), status: 'active' },
    });
    for (const user of activeUsersWithoutPassword) {
      if (!user.username) continue;
      user.passwd = user.username;
      user.password_hash = null;
      user.password_updated_at = new Date();
      await this.usersRepository.save(user);
    }
    if (activeUsersWithoutPassword.length) {
      return;
    }

    const initialPassword =
      this.configService.get<string>('INITIAL_ADMIN_PASSWORD') ??
      this.configService.get<string>('ADMIN_INITIAL_PASSWORD');
    if (!initialPassword) {
      return;
    }

    const adminUsernames = new Set(
      [
        'admin',
        ...(this.configService.get<string>('APP_ADMIN_USERNAMES') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        ...(this.configService.get<string>('ADMIN_USERNAMES') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      ].filter(Boolean),
    );
    if (!adminUsernames.size) {
      return;
    }
    const adminUserIds = await this.findAdminUserIds();

    const users = await this.usersRepository.find({
      where: { passwd: IsNull() },
    });
    for (const user of users) {
      if (!adminUsernames.has(user.username) && !adminUserIds.has(user.id)) {
        continue;
      }
      user.passwd = initialPassword;
      user.password_hash = null;
      user.password_updated_at = new Date();
      await this.usersRepository.save(user);
    }
  }

  private async findAdminUserIds() {
    const rows: Array<{ user_id: string }> = await this.dataSource.query(
      `
        SELECT user_role.user_id
        FROM user_roles user_role
        JOIN roles role ON role.id = user_role.role_id
        WHERE role.role_code = 'admin'
      `,
    );
    return new Set(rows.map((row) => row.user_id));
  }

  private async ensureUsersAuthSchema() {
    await this.ensureColumn(
      'users',
      'passwd',
      'VARCHAR(128) NULL AFTER username',
    );
    await this.ensureColumn(
      'users',
      'login_enabled',
      'TINYINT(1) NOT NULL DEFAULT 0 AFTER passwd',
    );
    await this.ensureColumn(
      'users',
      'password_hash',
      'VARCHAR(255) NULL AFTER feishu_open_id',
    );
    await this.ensureColumn(
      'users',
      'password_updated_at',
      'DATETIME NULL AFTER password_hash',
    );
    await this.ensureColumn(
      'users',
      'last_login_at',
      'DATETIME NULL AFTER password_updated_at',
    );
  }

  private async ensureColumn(
    tableName: string,
    columnName: string,
    definition: string,
  ) {
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName],
    );
    if (Number(rows?.[0]?.count ?? 0) > 0) {
      return;
    }
    await this.dataSource.query(
      `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`,
    );
  }

  private async attachRoleCodes(users: UserEntity[]) {
    if (!users.length) {
      return [];
    }
    return Promise.all(users.map((user) => this.attachRoleCodesToUser(user)));
  }

  private async attachRoleCodesToUser(user: UserEntity) {
    const profile = await buildAccessProfile(this.dataSource, user);
    const { passwd, password_hash, ...safeUser } = user;
    return {
      ...safeUser,
      role_codes: profile.roleCodes,
      effective_roles: profile.effectiveRoles,
      permissions: profile.permissions,
      data_scope: profile.dataScope,
      owned_business_category_codes: profile.ownedBusinessCategoryCodes,
      dispatch_customer_codes: profile.dispatchCustomerCodes,
      product_review_types: profile.productReviewTypes,
      customer_review_codes: profile.customerReviewCodes,
      is_admin: profile.isAdmin,
    };
  }
}
