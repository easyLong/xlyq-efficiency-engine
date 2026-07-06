(function () {
  function unwrap(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.value)) return value.value;
    return value ? [value] : [];
  }

  function create({ apiBase, getAccessToken, canAccess }) {
    async function request(path, options = {}) {
      return window.XlyqAppShell.request({
        apiBase,
        path,
        options,
        getAccessToken,
      });
    }

    async function loadBootstrap() {
      const [users, health] = await Promise.all([
        request("/auth/login-users"),
        request("/health"),
      ]);

      return {
        users: unwrap(users),
        health,
      };
    }

    async function loadAppData() {
      const quoteVisible = Boolean(canAccess?.("quote.view_all"));
      const aiPreviewVisible = Boolean(
        canAccess?.("ai_preview.view_all") || canAccess?.("ai_preview.view_owned"),
      );
      const [
        projects,
        customers,
        contactContexts,
        users,
        historyBoard,
        aiPreviewCandidates,
        quotations,
        businessPlatformDimensions,
        businessCategoryRelations,
        businessCategoryOwners,
        health,
      ] = await Promise.all([
        request("/projects"),
        request("/customers"),
        request("/contact-contexts?status=active").catch(() => []),
        request("/users"),
        request("/requirements/history-board"),
        aiPreviewVisible
          ? request("/requirements/ai-preview-candidates?limit=12&scope=mine").catch(() => [])
          : Promise.resolve([]),
        quoteVisible ? request("/quotations") : Promise.resolve([]),
        request("/dimensions?type=business_platform").catch(() => []),
        request("/dimensions/business-category-relations").catch(() => []),
        aiPreviewVisible ? request("/requirements/business-category-owners").catch(() => []) : Promise.resolve([]),
        request("/health"),
      ]);

      return {
        projects: unwrap(projects),
        customers: unwrap(customers),
        contactContexts: unwrap(contactContexts),
        users: unwrap(users),
        requirements: unwrap(historyBoard?.requirements),
        requirementItems: unwrap(historyBoard?.requirementItems),
        tasks: unwrap(historyBoard?.tasks),
        quotations: unwrap(quotations),
        quoteMappings: unwrap(historyBoard?.quoteMappings),
        aiPreviewCandidates: unwrap(aiPreviewCandidates),
        businessPlatformDimensions: unwrap(businessPlatformDimensions),
        businessCategoryRelations: unwrap(businessCategoryRelations),
        businessCategoryOwners: unwrap(businessCategoryOwners),
        health,
      };
    }

    return {
      request,
      unwrap,
      loadBootstrap,
      loadAppData,
    };
  }

  window.XlyqApiClient = {
    create,
    unwrap,
  };
})();
