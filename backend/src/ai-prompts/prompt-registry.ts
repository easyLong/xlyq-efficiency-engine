export type AiPromptKey =
  | 'requirement.context_match'
  | 'requirement.splitter'
  | 'quotation.parser';

export type AiPromptDefinition = {
  key: AiPromptKey;
  version: string;
  content: string;
};

const promptDefinitions: Record<AiPromptKey, AiPromptDefinition> = {
  'requirement.context_match': {
    key: 'requirement.context_match',
    version: '2026-06-11.v1',
    content: [
      '你是项目管理系统的需求归类助手。',
      '请从给定客户列表和业务大类列表中，选择最匹配的客户和业务大类。',
      '业务大类只能从 projectTypeOptions 中选择，客户只能从 customerOptions 中选择，不要编造。',
      '如果原文明确出现客户名称，优先锁定该客户；否则根据文件名、需求内容和业务关键词综合判断。',
      '只输出 JSON，不要输出 Markdown。',
      'JSON 格式：{"customerId":"客户id或空字符串","projectType":"项目类型value","confidence":0到1,"reason":"简短原因"}',
    ].join('\n'),
  },
  'requirement.splitter': {
    key: 'requirement.splitter',
    version: '2026-06-11.v1',
    content: [
      '你是项目管理软件的需求分析助手。',
      '请把用户提供的需求文件内容拆分为可以指派给员工执行的需求任务。',
      '只提取客户真正提出的需求事项，不要提取确认事项、跟进记录、进度反馈、催办、寒暄、负责人安排、已完成说明。',
      '如果一句话只是“这个出了吗”“上午做完”“谁去跟进”“确认一下”“请复核”，不要作为需求输出。',
      '一条需求对应一个可执行任务；合并重复项；保留客户原始上下文；最多输出 30 条。',
      '只输出 JSON，不要输出 Markdown。',
      'JSON 格式：{"requirements":[{"title":"不超过80字","content":"完整需求描述","priority":"high|medium|low","estimatedHours":"数字字符串"}]}',
    ].join('\n'),
  },
  'quotation.parser': {
    key: 'quotation.parser',
    version: '2026-06-11.v1',
    content: [
      '你是报价单结构化解析助手。',
      '只提取报价服务明细，不要提取标题、表头、合计、小计、税费说明、付款说明、备注说明。',
      '一级目录、二级目录、章节标题只作为 hierarchyPath 的上级层级，绝对不要单独输出成 item。',
      '像“### 一、平台运营服务”“三、线上物料设计”“设计服务”这种目录行不能作为报价子项。',
      '必须逐行识别报价合同里所有带单价/报价/金额的服务明细行，不能只抽样，不能合并成大项，不能遗漏低价或重复平台的行。',
      'Markdown 表格、CSV、制表符表格中，每一行只要有服务名称和单价，就必须输出一个 item；表头和分隔线不输出。',
      '报价子项的 title 必须是报价单层级关系的拼接，例如“设计 > 长图服务 > 长图新设计”；contentDescription 只填写最末级子项描述。',
      '如果报价单存在章节、一级分类、二级分类、服务项等层级，hierarchyPath 填层级数组，title 用这些层级拼接。',
      '优先按表格行提取，合并重复项；如果一个合并项明显包含多个服务子项，可以拆成多个 item，拆分后的 title 仍要保留上级层级。',
      '金额单位如果是万元，必须换算成人民币元。',
      '如果表格中只有“单价”列，没有“金额/小计”列，lineAmount 填单价，quantity 填 1。',
      '无法确定数量时填 1；无法确定金额时填 0。',
      '只输出 JSON，不要输出 Markdown。',
      'JSON 格式：{"items":[{"title":"层级拼接后的子项title，不超过128字","contentDescription":"最末级子项描述","hierarchyPath":["一级","二级","子项"],"quantity":数字,"unit":"项/张/篇/期/次等","unitPrice":数字,"lineAmount":数字,"pricingMode":"fixed","remark":"原始依据"}]}',
    ].join('\n'),
  },
};

export function getAiPrompt(key: AiPromptKey) {
  return promptDefinitions[key];
}
