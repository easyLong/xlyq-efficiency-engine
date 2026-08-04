# 权限控制设计

更新时间：2026-08-04

## 目标

权限系统用于把上线后的后台能力按职责拆开，避免执行员工看到管理、报价、结算和未指派任务信息。

当前版本已启用账号下拉 + 密码登录；登录结果返回角色、权限点和数据范围。后端接口通过统一 Guard 校验，前端按权限控制页面和操作入口。

## 角色

| 角色 | 判定方式 | 页面范围 | 数据范围 |
| --- | --- | --- | --- |
| 管理员 | `user_roles` 包含 `admin`，或用户名在 `APP_ADMIN_USERNAMES` / `ADMIN_USERNAMES` 中 | 全部页面 | 全部需求、任务、报价、结算 |
| 派发者 | `user_roles` 包含 `dispatcher`，或在 `customer_workflow_members` 中配置为基金派发者 | 需求与指派、需求面板、消息 | 配置基金下的需求和任务 |
| 一审人员 | `user_roles` 包含 `product_reviewer`，或在 `business_category_review_members` 中配置 | 需求与指派、需求面板、消息 | 配置业务大类下的一审任务 |
| 二审人员 | `user_roles` 包含 `second_reviewer`（兼容旧值 `customer_owner`），或在 `customer_workflow_members` 中配置为基金二审 | 需求与指派、需求面板、消息 | 配置基金下的二审任务 |
| 执行人 | 默认普通成员 | 需求与指派、消息 | 只看指派给自己的任务 |

## 权限点

管理员拥有 `*`，可访问所有页面和接口。

派发者权限：

- `page.requirements`
- `page.dashboard`
- `page.messages`
- `requirement.view_owned`
- `requirement.create`
- `requirement.edit_owned`
- `task.view_owned`
- `task.assign_owned`
- `dashboard.view_global`
- `dashboard.employee_detail`
- `task.remind_execution_owned`
- `ai_preview.view_owned`
- `ai_preview.confirm_owned`

一审、二审人员权限：

- `page.requirements`
- `page.dashboard`
- `page.messages`
- `requirement.view_owned`
- `task.view_owned`
- `task.accept_owned`
- `task.return_owned`

执行人权限：

- `page.requirements`
- `page.messages`
- `task.view_assigned`
- `task.submit_assigned`

## 页面可见性

| 页面 / 模块 | 管理员 | 派发者 | 一审 / 二审 | 执行人 |
| --- | --- | --- | --- | --- |
| 需求录入与创建 | 可见 | 可见 | 隐藏 | 隐藏 |
| AI 预览需求 | 全量可见并可确认 | 只看负责基金并可确认 | 隐藏 | 隐藏 |
| 历史需求任务状态 | 全量 | 负责基金范围 | 当前审核范围和处理历史 | 只看分配给自己的任务 |
| 需求面板 | 可见 | 可见 | 可见 | 隐藏 |
| 合同报价录入 / 结算统计 | 可见 | 隐藏 | 隐藏 | 隐藏 |
| 消息通知 | 可见 | 可见 | 可见 | 可见 |

补充说明：派发者在需求面板中可以查看全体员工的工作量和任务负载，但该全局范围仅用于调度分析，不改变其需求、任务编辑和指派的基金数据范围。

## 历史需求任务状态规则

- 管理员可以看到所有需求、任务、报价状态，并进行报价、指派、验收、退回等操作。
- 派发者可以创建需求、确认 AI 预览候选，并在负责基金范围内派发或改派任务。
- 一审和二审人员只处理当前配置范围内的审核任务，不能录入或创建需求。
- 执行人只能看到已经指派给自己的任务；看不到待指派任务、待报价入口、报价信息和结算信息。
- 多人一审、二审必须先领取当前审核工作项；领取使用数据库原子更新，领取后只有领取人可通过或退回，其他候选人显示实际领取人并转为只读。
- 如果执行人页面状态误停留在 `待指派` 或 `待报价` 筛选，前端会自动切回 `全部`。

## 后端实现

核心文件：

- `backend/src/common/access-control.ts`：构建用户权限画像。
- `backend/src/common/guards/mvp-auth.guard.ts`：统一读取访问 Token、识别用户、校验权限。
- `backend/src/common/decorators/admin-only.decorator.ts`：管理员接口标记。
- `backend/src/common/decorators/permission.decorator.ts`：普通权限点接口标记。

主要接口规则：

- 报价和报价映射接口使用 `@AdminOnly()`。
- 需求、AI 预览、任务接口按具体动作使用 `@Permission(...)`。
- 需求历史看板、任务列表、任务看板会按用户权限画像裁剪数据。
- `GET /tasks/board?scope=global` 只对拥有 `dashboard.view_global` 的用户开放；全局模式取消默认 500 条看板限制，但仍为只读看板数据。
- 员工负载和员工详情接口只对拥有 `dashboard.employee_detail` 的用户开放。
- 催交付接口除权限点外，还会校验任务的 `dispatcher_user_id`；管理员可处理全部任务，派发者只能处理自己派发的任务。
- 需求面板的报价统计对非管理员隐藏。

## AI 预览权限

- 管理员拥有 `*`，可以查看全部待确认候选。
- 派发者拥有 `ai_preview.view_owned` / `ai_preview.confirm_owned`，只能查看和确认负责基金的候选。
- 一审、二审和执行人不显示 AI 预览面板。

## 前端实现

登录后用户对象返回：

- `role_codes`
- `effective_roles`
- `permissions`
- `data_scope`
- `owned_business_category_codes`（旧客户端兼容字段，固定为空）
- `dispatch_customer_codes`
- `product_review_types`
- `customer_review_codes`
- `is_admin`

前端使用 `can(permission)` 控制：

- 导航入口是否展示。
- 整个需求录入区域是否展示；隐藏时历史任务列表自动铺满页面。
- 合同报价录入、结算统计是否可见。
- 历史需求中的报价信息和待报价筛选是否展示。
- 指派、改派、验收、退回、编辑、删除等操作按钮是否展示。
- 执行人是否隐藏 `待指派` 指标和筛选。
- 员工负载与派发人/执行人统计中的飞书头像使用 `users.avatar_url`，无头像时回退为姓名首字。

## 验证清单

```bash
cd backend
npm run build
```

手工验证建议：

1. 管理员登录：能看到合同报价录入、结算统计、待报价、待指派和所有历史任务。
2. 派发者登录：能看到需求录入和负责基金的 AI 预览，并能创建、派发需求任务。
3. 一审或二审登录：需求录入和 AI 预览完全隐藏，只显示职责相关任务。
4. 执行人登录：需求录入完全隐藏，只看到分配给自己的任务。
5. 派发者登录：需求面板可查看全局员工负载和员工详情，但只能在自己负责基金范围内创建、编辑、指派任务。
## 2026-07-01 权限补充

- 新增页面权限点：`page.group_management`。
- 当前实现中管理员拥有 `*`，因此可访问“群管理”页面。
- 派发者、审核人员和执行人默认没有 `page.group_management`，不会显示群管理入口。
- 群管理用于维护基金客户、业务平台、群昵称和对接人映射，属于基础数据配置，建议继续保持管理员可见。
