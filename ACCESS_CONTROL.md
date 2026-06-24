# 权限控制设计

更新时间：2026-06-22

## 目标

权限系统用于把上线后的后台能力按职责拆开，避免执行员工看到管理、报价、结算和未指派任务信息。

当前版本已启用账号下拉 + 密码登录；登录结果返回角色、权限点和数据范围。后端接口通过统一 Guard 校验，前端按权限控制页面和操作入口。

## 角色

| 角色 | 判定方式 | 页面范围 | 数据范围 |
| --- | --- | --- | --- |
| 管理员 | `user_roles` 包含 `admin`，或用户名在 `APP_ADMIN_USERNAMES` / `ADMIN_USERNAMES` 中 | 全部页面 | 全部需求、任务、报价、结算 |
| 业务负责人 | `user_roles` 包含 `owner`，或在 `business_category_owner_configs` 中负责至少一个业务大类 | 需求与指派、需求面板、消息 | 负责业务大类下的需求和任务 |
| 执行人 | 默认普通成员 | 需求与指派、消息 | 只看指派给自己的任务 |

当前管理员名单：

- 雷声
- 韦莉香
- 廖丽婷

## 权限点

管理员拥有 `*`，可访问所有页面和接口。

业务负责人权限：

- `page.requirements`
- `page.dashboard`
- `page.messages`
- `requirement.view_owned`
- `requirement.create`
- `requirement.edit_owned`
- `task.view_owned`
- `task.assign_owned`
- `task.accept_owned`
- `task.return_owned`
- `ai_preview.view_owned`
- `ai_preview.confirm_owned`

执行人权限：

- `page.requirements`
- `page.messages`
- `task.view_assigned`
- `task.submit_assigned`

## 页面可见性

| 页面 / 模块 | 管理员 | 业务负责人 | 执行人 |
| --- | --- | --- | --- |
| 需求与指派 | 可见 | 可见 | 可见 |
| AI 预览需求 | 全量可见并可确认 | 只看负责范围并可确认 | 不可见 |
| 历史需求任务状态 | 全量 | 负责范围 | 只看分配给自己的任务 |
| 待指派筛选和指标 | 可见 | 可见 | 不可见 |
| 待报价筛选和报价操作 | 可见 | 不可见 | 不可见 |
| 需求面板 | 可见 | 可见 | 不可见 |
| 合同报价录入 | 可见 | 不可见 | 不可见 |
| 结算统计 | 可见 | 不可见 | 不可见 |
| 消息通知 | 可见 | 可见 | 可见 |

## 历史需求任务状态规则

- 管理员可以看到所有需求、任务、报价状态，并进行报价、指派、验收、退回等操作。
- 业务负责人只能看到自己负责业务大类下的需求和任务；能创建需求、指派执行人、验收和退回任务；看不到报价金额、报价子项和结算信息。
- 执行人只能看到已经指派给自己的任务；看不到待指派任务、待报价入口、报价信息和结算信息。
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
- 需求面板的报价统计对非管理员隐藏。

## 前端实现

登录后用户对象返回：

- `role_codes`
- `effective_roles`
- `permissions`
- `data_scope`
- `owned_business_category_codes`
- `is_admin`

前端使用 `can(permission)` 控制：

- 导航入口是否展示。
- 合同报价录入、结算统计是否可见。
- 历史需求中的报价信息和待报价筛选是否展示。
- 指派、改派、验收、退回、编辑、删除等操作按钮是否展示。
- 执行人是否隐藏 `待指派` 指标和筛选。

## 验证清单

```bash
cd backend
npm run build
```

手工验证建议：

1. 管理员登录：能看到合同报价录入、结算统计、待报价、待指派和所有历史任务。
2. 业务负责人登录：能看到负责业务大类下的历史任务和需求面板，但看不到报价金额、报价入口、合同报价录入和结算统计。
3. 执行人登录：只看到分配给自己的任务，看不到待指派、待报价、报价信息、合同报价录入、结算统计和需求面板。
