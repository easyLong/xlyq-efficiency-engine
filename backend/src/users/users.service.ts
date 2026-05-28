import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
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
  ) {}

  async findAll() {
    return this.usersRepository.find({
      order: { created_at: 'DESC' },
      take: 50,
    });
  }

  async getMe() {
    return this.usersRepository.findOne({
      where: { username: 'bool' },
    });
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
    return user;
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
}
