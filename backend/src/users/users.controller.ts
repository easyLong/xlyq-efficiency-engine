import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { UserEntity } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('users')
  findAll() {
    return this.usersService.findAll();
  }

  @Public()
  @Get('auth/login-users')
  findLoginUsers() {
    return this.usersService.findLoginUsers();
  }

  @Public()
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.usersService.login(dto);
  }

  @Public()
  @Get('auth/login-config')
  getLoginConfig() {
    return this.usersService.getLoginConfig();
  }

  @Public()
  @Post('auth/password-login')
  loginWithPassword(@Body() dto: PasswordLoginDto) {
    return this.usersService.loginWithPassword(dto);
  }

  @Get('users/me')
  getMe(@Req() request: Request & { user?: UserEntity }) {
    return request.user?.id ? this.usersService.findOne(request.user.id) : null;
  }

  @Get('roles')
  findRoles() {
    return this.usersService.findRoles();
  }

  @Get('users/:userId')
  findOne(@Param('userId') userId: string) {
    return this.usersService.findOne(userId);
  }

  @Post('users')
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch('users/:userId')
  update(@Param('userId') userId: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(userId, dto);
  }
}
