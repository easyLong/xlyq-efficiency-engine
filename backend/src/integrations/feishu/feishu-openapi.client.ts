import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type FeishuTokenResponse = {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

@Injectable()
export class FeishuOpenApiClient {
  private tenantAccessToken: string | null = null;
  private tenantAccessTokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  async getTenantAccessToken() {
    const now = Date.now();
    if (
      this.tenantAccessToken &&
      this.tenantAccessTokenExpiresAt - 60_000 > now
    ) {
      return this.tenantAccessToken;
    }

    const appId = this.configService.get<string>('FEISHU_APP_ID');
    const appSecret = this.configService.get<string>('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException(
        'FEISHU_APP_ID and FEISHU_APP_SECRET are required for Feishu app APIs',
      );
    }

    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
        }),
      },
    );
    const body = (await response.json()) as FeishuTokenResponse;
    if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
      throw new Error(
        `Failed to get Feishu tenant_access_token: ${response.status} ${body.msg ?? ''}`,
      );
    }

    this.tenantAccessToken = body.tenant_access_token;
    this.tenantAccessTokenExpiresAt = now + (body.expire ?? 7200) * 1000;
    return this.tenantAccessToken;
  }

  async request(pathOrUrl: string | URL, init: RequestInit = {}) {
    const tenantAccessToken = await this.getTenantAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${tenantAccessToken}`);
    return fetch(pathOrUrl, {
      ...init,
      headers,
    });
  }

  async postJson(pathOrUrl: string | URL, body: unknown) {
    return this.request(pathOrUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  }
}
