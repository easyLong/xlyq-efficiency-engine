import { Injectable } from '@nestjs/common';
import { FeishuOpenApiClient } from './feishu-openapi.client';

export const ASSET_SHEET_HEADERS = [
  '编号',
  '资产地址',
  '图片地址（可多张）',
  '交付链接',
];

export type AssetSheetRow = {
  sequence: number;
  assetUrl: string;
  imageUrls: string[];
  linkUrl: string;
};

@Injectable()
export class FeishuSheetClient {
  constructor(private readonly openApiClient: FeishuOpenApiClient) {}

  async createAssetSpreadsheet(input: {
    title: string;
    folderToken?: string | null;
  }) {
    const createPayload: Record<string, unknown> = { title: input.title };
    if (input.folderToken) {
      createPayload.folder_token = input.folderToken;
    }

    const createResponse = await this.openApiClient.postJson(
      'https://open.feishu.cn/open-apis/sheets/v3/spreadsheets',
      createPayload,
    );
    const createBody = (await createResponse.json()) as {
      code?: number;
      msg?: string;
      data?: {
        spreadsheet?: {
          spreadsheet_token?: string;
          url?: string;
        };
        spreadsheet_token?: string;
        url?: string;
      };
    };

    if (!createResponse.ok || createBody.code !== 0) {
      throw new Error(
        `Feishu spreadsheet create failed: ${createResponse.status} ${createBody.msg ?? ''}`,
      );
    }

    const spreadsheetToken =
      createBody.data?.spreadsheet?.spreadsheet_token ??
      createBody.data?.spreadsheet_token;
    const spreadsheetUrl =
      createBody.data?.spreadsheet?.url ??
      createBody.data?.url ??
      (spreadsheetToken
        ? `https://www.feishu.cn/sheets/${spreadsheetToken}`
        : null);

    if (!spreadsheetToken || !spreadsheetUrl) {
      throw new Error('Feishu spreadsheet create response missing token/url');
    }

    const sheetId = await this.getFirstSheetId(spreadsheetToken);
    if (sheetId) {
      await this.writeAssetSheetTemplate(spreadsheetToken, sheetId);
    }

    return {
      spreadsheetToken,
      spreadsheetUrl,
      sheetId,
    };
  }

  async grantSheetEditPermission(input: {
    spreadsheetToken: string;
    openId: string;
  }) {
    return this.openApiClient.postJson(
      `https://open.feishu.cn/open-apis/drive/v1/permissions/${input.spreadsheetToken}/members?type=sheet`,
      {
        member_type: 'openid',
        member_id: input.openId,
        perm: 'edit',
      },
    );
  }

  async readAssetSheetRows(spreadsheetToken: string) {
    const sheetId = await this.getFirstSheetId(spreadsheetToken);
    if (!sheetId) {
      throw new Error('Asset sheet has no sheetId');
    }

    const range = `${sheetId}!A2:D501`;
    const url = new URL(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values_batch_get`,
    );
    url.searchParams.append('ranges', range);
    const response = await this.openApiClient.request(url);
    const body = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: {
        valueRanges?: Array<{
          values?: unknown[][];
        }>;
      };
    };

    if (!response.ok || body.code !== 0) {
      throw new Error(
        `Feishu asset sheet read failed: ${response.status} ${body.msg ?? ''}`,
      );
    }

    const rows = body.data?.valueRanges?.[0]?.values ?? [];
    const assets = rows
      .map((row, index) => ({
        sequence: index + 1,
        assetUrl: String(row[1] ?? '').trim(),
        imageUrls: String(row[2] ?? '')
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(Boolean),
        linkUrl: String(row[3] ?? '').trim(),
      }))
      .filter(
        (row) =>
          row.assetUrl.length > 0 ||
          row.imageUrls.length > 0 ||
          row.linkUrl.length > 0,
      );

    return { range, assets };
  }

  private async getFirstSheetId(spreadsheetToken: string) {
    const response = await this.openApiClient.request(
      `https://open.feishu.cn/open-apis/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
    );
    const body = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: {
        sheets?: Array<{
          sheet_id?: string;
          sheetId?: string;
        }>;
      };
    };
    if (!response.ok || body.code !== 0) {
      throw new Error(
        `Feishu sheet query failed: ${response.status} ${body.msg ?? ''}`,
      );
    }
    const firstSheet = body.data?.sheets?.[0];
    return firstSheet?.sheet_id ?? firstSheet?.sheetId ?? null;
  }

  private async writeAssetSheetTemplate(
    spreadsheetToken: string,
    sheetId: string,
  ) {
    const rows = [
      ASSET_SHEET_HEADERS,
      ...Array.from({ length: 500 }, () => ['=ROW()-1', '', '', '']),
    ];
    const response = await this.openApiClient.request(
      `https://open.feishu.cn/open-apis/sheets/v2/spreadsheets/${spreadsheetToken}/values`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueRange: {
            range: `${sheetId}!A1:D501`,
            values: rows,
          },
        }),
      },
    );
    const body = (await response.json()) as {
      code?: number;
      msg?: string;
    };
    if (!response.ok || body.code !== 0) {
      throw new Error(
        `Feishu sheet template write failed: ${response.status} ${body.msg ?? ''}`,
      );
    }
  }
}
