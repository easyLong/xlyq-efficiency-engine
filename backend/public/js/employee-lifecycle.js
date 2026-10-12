// Personnel status affects staffing views, while historical tasks stay intact.
function isDepartedEmployee(user) {
  return user?.employment_status === "departed";
}

function isActiveEmployee(user) {
  return Boolean(user) && user.status === "active" && !isDepartedEmployee(user);
}

function employeeRankingUsers() {
  return (state.users || []).filter(user => isActiveEmployee(user)
    || (state.employeeHistoryIncludeDeparted && isDepartedEmployee(user)));
}

function employeeLabel(userId) {
  const user = getLookupMaps().userById.get(userId);
  return assigneeName(userId) + (isDepartedEmployee(user) ? " · 已离职" : "");
}

function isEmployeeHandoverTask(task) {
  return task && !["completed", "cancelled", "canceled"].includes(task.status)
    && isDepartedEmployee(getLookupMaps().userById.get(task.assignee_user_id));
}

function setEmployeeHistoryIncludeDeparted(checked) {
  state.employeeHistoryIncludeDeparted = Boolean(checked);
  renderEmployeeTop(state.employeeHistoryTasks || []);
  renderEmployeeCenterOverview(state.employeeHistoryTasks || []);
  renderOwnerTaskBoard(state.employeeHistoryTasks || []);
  qs("employeeRankingScope").textContent = checked ? "排行包含离职员工" : "排行仅显示在职员工";
}

function employeeHandoverTasks() {
  return unwrap(state.analyticsData?.tasks).filter(isEmployeeHandoverTask);
}

function renderEmployeeHandover() {
  const panel = qs("employeeHandoverPanel");
  if (!panel) return;
  panel.classList.toggle("hidden", !can("dashboard.employee_detail"));
  if (!can("dashboard.employee_detail")) return;
  const tasks = employeeHandoverTasks();
  qs("employeeHandoverCount").textContent = tasks.length;
  renderSimpleTable("employeeHandoverBox", tasks,
    ["原执行人", "基金", "需求 / 任务", "当前状态", "处理"], task => {
      const requirement = requirementForTask(task);
      return [safeText(employeeLabel(task.assignee_user_id)),
        safeText(customerName(requirement?.customer_code) || requirement?.customer_code || "—"),
        `<span title="${escapeAttr(requirement?.title || task.task_name || "")}">${safeText(task.task_no)} · ${safeText(requirement?.title || task.task_name || "")}</span>`,
        safeText(taskDisplayStatusLabel(task)),
        `<button class="employee-history-detail-btn" type="button" onclick="openEmployeeHandoverTask('${escapeAttr(task.id)}')">${task.status === "pending_review" ? "查看审核" : "查看交接"}</button>`];
    }, "暂无离职员工的待交接任务");
}

function openEmployeeHandoverTask(taskId) {
  const task = unwrap(state.analyticsData?.tasks).find(item => item.id === taskId);
  if (!task) return toast("任务数据已更新，请刷新后重试");
  const requirement = requirementForTask(task);
  resetDimensionFilters();
  state.requirementFilter = "all";
  state.requirementDateFilters = { startDate: "", endDate: "" };
  state.requirementKeyword = task.task_no || requirement?.title || task.task_name || "";
  state.requirementKeywordVersion += 1;
  clearTimeout(state.requirementKeywordTimer);
  state.requirementKeywordTimer = null;
  state.requirementFilterUiKey = "";
  closeEmployeeManagement();
  setRequirementView("tasks");
  switchView("requirements");
}

async function openEmployeeManagement() {
  if (!can("permission.manage")) return;
  qs("employeeManagementBackdrop").classList.remove("hidden");
  qs("employeeManagementFeedback").textContent = "";
  qs("employeeManagementBody").innerHTML = '<div class="empty-list">正在加载人员…</div>';
  try {
    state.users = unwrap(await request("/users"));
    invalidateLookupMaps();
    renderEmployeeManagement();
  } catch (error) {
    qs("employeeManagementBody").textContent = error.message;
  }
}

function closeEmployeeManagement() {
  qs("employeeManagementBackdrop")?.classList.add("hidden");
}

function renderEmployeeManagement() {
  const keyword = String(qs("employeeManagementSearch")?.value || "").trim().toLowerCase();
  const pending = employeeHandoverTasks();
  const allTasks = unwrap(state.analyticsData?.tasks);
  const users = (state.users || []).filter(user => !keyword
    || [userDisplayName(user), user.username, user.center_name].some(value => String(value || "").toLowerCase().includes(keyword)));
  renderSimpleTable("employeeManagementBody", users,
    ["员工", "所属中心", "人员状态", "离职日期", "未完成任务", "操作"], user => {
      const departed = isDepartedEmployee(user);
      const unfinished = allTasks.filter(task => task.assignee_user_id === user.id
        && !["completed", "cancelled", "canceled"].includes(task.status));
      const disabled = state.employeeManagementBusy || user.id === state.user?.id;
      return [safeText(userDisplayName(user)), safeText(employeeCenterLabel(user.center_name) || "—"),
        departed ? '<span class="employee-departed-badge">已离职</span>' : (user.status === "active" ? "在职" : "已停用"),
        `<input class="employee-departure-date" id="employee-date-${escapeAttr(user.id)}" type="date" value="${escapeAttr(String(user.departed_at || "").slice(0, 10))}" aria-label="${escapeAttr(userDisplayName(user))}的离职日期（选填）" ${disabled ? "disabled" : ""} />`,
        String(unfinished.length),
        `<button class="employee-history-detail-btn" type="button" ${disabled ? "disabled" : ""} onclick="updateEmployeeEmployment('${escapeAttr(user.id)}', '${departed ? "active" : "departed"}')">${departed ? "恢复在职" : "离职归档"}</button>${departed ? ` <button class="employee-history-detail-btn" type="button" ${state.employeeManagementBusy ? "disabled" : ""} onclick="updateEmployeeEmployment('${escapeAttr(user.id)}', 'departed', true)">保存日期</button>` : ""}`];
    }, "没有匹配的员工");
  qs("employeeManagementSummary").textContent = `共 ${users.length} 名员工 · ${pending.length} 项待交接任务；离职日期可不填。恢复在职后，登录按原账号权限控制。`;
}

async function updateEmployeeEmployment(userId, employmentStatus, dateOnly = false) {
  if (!can("permission.manage") || state.employeeManagementBusy) return;
  const user = getLookupMaps().userById.get(userId);
  if (!user) return;
  const departedAt = qs(`employee-date-${userId}`)?.value || "";
  if (!dateOnly && !await confirmDialog({
    title: employmentStatus === "departed" ? "离职归档" : "恢复在职",
    message: employmentStatus === "departed"
      ? `归档 ${userDisplayName(user)} 后将停止登录、新指派和通知。历史任务和结算保留，未完成任务进入待交接清单，待审核任务继续原审核流程。`
      : `确认将 ${userDisplayName(user)} 恢复为在职员工？`,
    okText: employmentStatus === "departed" ? "确认归档" : "恢复在职",
  })) return;
  state.employeeManagementBusy = true;
  qs("employeeManagementFeedback").textContent = "正在保存…";
  renderEmployeeManagement();
  try {
    const updated = await request(`/users/${encodeURIComponent(userId)}/employment`, {
      method: "PATCH", body: { employmentStatus,
        ...(employmentStatus === "departed" ? { departedAt: departedAt || null } : {}) },
    });
    Object.assign(user, updated);
    invalidateLookupMaps();
    state.loginUsers = unwrap(await request("/auth/login-users").catch(() => state.loginUsers));
    renderLoginUsers();
    await refreshAnalytics();
    qs("employeeManagementFeedback").textContent = dateOnly ? "离职日期已保存" : (employmentStatus === "departed" ? "已归档，历史任务与结算已保留" : "已恢复在职");
  } catch (error) {
    qs("employeeManagementFeedback").textContent = error.message;
  } finally {
    state.employeeManagementBusy = false;
    renderEmployeeManagement();
    renderEmployeeHandover();
  }
}
