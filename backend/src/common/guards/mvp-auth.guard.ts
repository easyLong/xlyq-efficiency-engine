import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { buildAccessProfile, hasPermission } from '../access-control';
import { ADMIN_ONLY_KEY } from '../decorators/admin-only.decorator';
import { PERMISSIONS_KEY } from '../decorators/permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserEntity } from '../../users/entities/user.entity';

@Injectable()
export class MvpAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: UserEntity;
    }>();
    const header = request.headers.authorization ?? '';
    const match = /^Bearer\s+mvp-(.+)$/i.exec(header);
    if (!match?.[1]) {
      throw new UnauthorizedException('Missing MVP access token');
    }

    const user = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id: match[1], status: 'active' },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid MVP access token');
    }
    request.user = user;

    const accessProfile = await buildAccessProfile(this.dataSource, user);
    const adminOnly = this.reflector.getAllAndOverride<boolean>(
      ADMIN_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (adminOnly && !accessProfile.isAdmin) {
      throw new ForbiddenException('Admin permission required');
    }
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (
      requiredPermissions?.length &&
      !requiredPermissions.some((permission) =>
        hasPermission(accessProfile, permission),
      )
    ) {
      throw new ForbiddenException('Permission denied');
    }
    return true;
  }
}
