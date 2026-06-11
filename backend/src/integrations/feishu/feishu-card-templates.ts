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
  const { task, token } = input;
  return buildProgressCard({
    title: '任务进度反馈',
    text: `任务 ${task.task_no}「${task.task_name}」已标记为已完成。`,
    actions: [
      callbackButton('再次打开', {
        action: 'task_progress_reopen',
        taskId: task.id,
        taskNo: task.task_no,
        token,
      }),
      disabledButton('已完成'),
    ],
  });
}

export function buildActiveProgressCard(input: FeishuTaskCardInput) {
  const { task, token, assetSheetUrl } = input;
  return buildProgressCard({
    title: '任务进度反馈',
    text: `任务 ${task.task_no}「${task.task_name}」已重新打开，请继续反馈当前进度。`,
    actions: [
      urlButton('进行中', assetSheetUrl),
      callbackButton('已完成', {
        action: 'task_progress_completed',
        taskId: task.id,
        taskNo: task.task_no,
        token,
      }),
    ],
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

function disabledButton(text: string) {
  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: text,
    },
    type: 'default',
    disabled: true,
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

function callbackButton(text: string, value: Record<string, unknown>) {
  return {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: text,
    },
    type: 'primary',
    value,
  };
}
