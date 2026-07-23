type FeishuCardActionInput = {
  text: string;
  url?: string;
  type?: string;
  value?: Record<string, unknown>;
};

type FeishuTaskCardInput = {
  task: {
    id: string;
    task_no: string;
    task_name: string;
  };
  token: string;
  assetSheetUrl: string;
};

export function buildInteractiveCard(input: {
  title: string;
  text: string;
  actions: FeishuCardActionInput[];
}) {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'green',
      title: {
        tag: 'plain_text',
        content: input.title,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: input.text,
        },
      },
      {
        tag: 'action',
        actions: input.actions.map((action) => ({
          tag: 'button',
          text: {
            tag: 'plain_text',
            content: action.text,
          },
          type: action.type ?? 'primary',
          ...(action.url ? { url: action.url } : {}),
          ...(action.value ? { value: action.value } : {}),
        })),
      },
    ],
  };
}

export function buildCompletedProgressCard(input: FeishuTaskCardInput) {
  const { task, assetSheetUrl } = input;
  return buildProgressCard({
    title: '任务交付流程已升级',
    text: `任务 ${task.task_no}「${task.task_name}」需在项目资产页提交交付，一审和二审通过后才会完成。`,
    actions: [urlButton('查看项目资产', assetSheetUrl)],
  });
}

export function buildActiveProgressCard(input: FeishuTaskCardInput) {
  const { task, assetSheetUrl } = input;
  return buildProgressCard({
    title: '任务交付流程已升级',
    text: `任务 ${task.task_no}「${task.task_name}」不再支持通过消息直接标记完成，请进入项目资产提交交付。`,
    actions: [urlButton('填写项目资产', assetSheetUrl)],
  });
}

function buildProgressCard(input: {
  title: string;
  text: string;
  actions: Array<Record<string, unknown>>;
}) {
  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      template: 'green',
      title: {
        tag: 'plain_text',
        content: input.title,
      },
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: input.text,
        },
      },
      {
        tag: 'action',
        actions: input.actions,
      },
    ],
  };
}

function urlButton(text: string, url: string) {
  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: text,
    },
    type: 'primary',
    url,
  };
}
