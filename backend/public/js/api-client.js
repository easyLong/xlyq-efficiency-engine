(function () {
  function unwrap(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.value)) return value.value;
    return value ? [value] : [];
  }

  function create({ apiBase, getAccessToken }) {
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
      const [
        projects,
        customers,
        contactContexts,
        users,
        requirements,
        requirementItems,
        tasks,
        quotations,
        quoteMappings,
        health,
      ] = await Promise.all([
        request("/projects"),
        request("/customers"),
        request("/contact-contexts?status=active").catch(() => []),
        request("/users"),
        request("/requirements"),
        request("/requirement-items"),
        request("/tasks"),
        request("/quotations"),
        request("/quote-mappings").catch(() => []),
        request("/health"),
      ]);

      return {
        projects: unwrap(projects),
        customers: unwrap(customers),
        contactContexts: unwrap(contactContexts),
        users: unwrap(users),
        requirements: unwrap(requirements),
        requirementItems: unwrap(requirementItems),
        tasks: unwrap(tasks),
        quotations: unwrap(quotations),
        quoteMappings: unwrap(quoteMappings),
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
