import {
  addWorkflowHandoffToAppUrl,
  assertProductionAppPublicBaseUrl,
  buildAppPublicUrl,
  isPublicHttpsAppBaseUrl,
  rebaseAppPublicUrl,
  resolveAppPublicBaseUrl,
} from './app-public-url';
import { verifyWorkflowHandoffToken } from './workflow-handoff-token';

describe('app public URL', () => {
  it('builds external task links with encoded parameters', () => {
    expect(
      buildAppPublicUrl(
        '/asset-sheet.html',
        { taskId: 'task 1', start: 1 },
        'http://192.168.10.5:3000/',
      ),
    ).toBe('http://192.168.10.5:3000/asset-sheet.html?taskId=task+1&start=1');
  });

  it('rebases stored localhost links onto the configured host', () => {
    expect(
      rebaseAppPublicUrl(
        'http://localhost:3000/asset-sheet.html?taskId=task-1',
        'https://efficiency.example.com',
      ),
    ).toBe('https://efficiency.example.com/asset-sheet.html?taskId=task-1');
  });

  it.each(['', 'http://localhost:3000', 'http://127.0.0.1:3000'])(
    'rejects an unusable external base URL: %s',
    (value) => {
      expect(() => resolveAppPublicBaseUrl(value)).toThrow();
    },
  );

  it('accepts only public HTTPS URLs for cloud deployment', () => {
    expect(isPublicHttpsAppBaseUrl('https://efficiency.example.com')).toBe(
      true,
    );
    expect(isPublicHttpsAppBaseUrl('http://efficiency.example.com')).toBe(
      false,
    );
    expect(isPublicHttpsAppBaseUrl('https://192.168.10.5:3000')).toBe(false);
    expect(() =>
      assertProductionAppPublicBaseUrl(
        'production',
        'http://192.168.10.5:3000',
      ),
    ).toThrow('public HTTPS URL');
    expect(() =>
      assertProductionAppPublicBaseUrl(
        'development',
        'http://192.168.10.5:3000',
      ),
    ).not.toThrow();
  });

  it('adds a signed recipient session only to this application URL', () => {
    const previousSecret = process.env.WORKFLOW_HANDOFF_SECRET;
    process.env.WORKFLOW_HANDOFF_SECRET = 'test-app-link-secret';
    try {
      const result = new URL(
        addWorkflowHandoffToAppUrl(
          'http://localhost:3000/asset-sheet.html?taskId=task-1#view=requirements&candidateId=candidate-1',
          'user-1',
          'https://efficiency.example.com',
        ),
      );
      expect(result.origin).toBe('https://efficiency.example.com');
      expect(result.searchParams.get('taskId')).toBe('task-1');
      const fragment = new URLSearchParams(result.hash.replace(/^#/, ''));
      expect(fragment.get('view')).toBe('requirements');
      expect(fragment.get('candidateId')).toBe('candidate-1');
      expect(
        verifyWorkflowHandoffToken(fragment.get('handoff') ?? '', {
          secret: 'test-app-link-secret',
        }).userId,
      ).toBe('user-1');
      expect(
        addWorkflowHandoffToAppUrl(
          'https://www.feishu.cn/drive/folder/folder-1',
          'user-1',
          'https://efficiency.example.com',
        ),
      ).toBe('https://www.feishu.cn/drive/folder/folder-1');
    } finally {
      if (previousSecret === undefined) {
        delete process.env.WORKFLOW_HANDOFF_SECRET;
      } else {
        process.env.WORKFLOW_HANDOFF_SECRET = previousSecret;
      }
    }
  });
});
