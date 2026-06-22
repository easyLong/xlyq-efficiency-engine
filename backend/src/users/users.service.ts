import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { buildAccessProfile } from '../common/access-control';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RoleEntity } from './entities/role.entity';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(RoleEntity)
    private readonly rolesRepository: Repository<RoleEntity>,
    private readonly dataSource: DataSource,
  ) {}

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
    return users.map((user) => ({
      username: user.username,
      display_name: user.display_name,
      source: user.source,
    }));
  }

  async login(dto: LoginDto) {
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
      email: dto.email ?? null,
      mobile: dto.mobile ?? null,
      avatar_url: dto.avatarUrl ?? null,
      status: 'active',
      source: dto.source ?? 'local',
      feishu_open_id: dto.feishuOpenId ?? null,
    });
    return this.usersRepository.save(user);
  }

  async update(userId: string, dto: UpdateUserDto) {
    const user = await this.findOne(userId);
    Object.assign(user, {
      display_name: dto.displayName ?? user.display_name,
      email: dto.email ?? user.email,
      mobile: dto.mobile ?? user.mobile,
      avatar_url: dto.avatarUrl ?? user.avatar_url,
      status: dto.status ?? user.status,
      feishu_open_id: dto.feishuOpenId ?? user.feishu_open_id,
    });
    return this.usersRepository.save(user);
  }

  private async attachRoleCodes(users: UserEntity[]) {
    if (!users.length) {
      return [];
    }
    return Promise.all(users.map((user) => this.attachRoleCodesToUser(user)));
  }

  private async attachRoleCodesToUser(user: UserEntity) {
    const profile = await buildAccessProfile(this.dataSource, user);
    return {
      ...user,
      role_codes: profile.roleCodes,
      effective_roles: profile.effectiveRoles,
      permissions: profile.permissions,
      data_scope: profile.dataScope,
      owned_business_category_codes: profile.ownedBusinessCategoryCodes,
      is_admin: profile.isAdmin,
    };
  }
}
