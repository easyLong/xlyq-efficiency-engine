(function attachWorkflowSession(global) {
  const SESSION_KEY = 'xlyqTaskSession';

  function tokenFromLocation() {
    return new URLSearchParams(location.hash.replace(/^#/, '')).get('handoff') || '';
  }

  function clearTokenFromLocation() {
    const url = new URL(location.href);
    const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
    fragment.delete('handoff');
    url.hash = fragment.toString();
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function store(session) {
    if (!session?.user?.username || !session?.accessToken) return false;
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        user: session.user,
        accessToken: session.accessToken,
        tokenType: session.tokenType || 'MVP',
        expiresAt: session.expiresAt || null,
      }),
    );
    return true;
  }

  async function establishFromLocation(apiBase = '/api/v1') {
    const token = tokenFromLocation();
    if (!token) return null;
    const response = await fetch(`${apiBase}/auth/workflow-handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ token }),
    });
    const text = await response.text();
    let result = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }
    if (!response.ok) {
      throw new Error(result?.message || text || '飞书账号自动登录失败');
    }
    if (!store(result)) {
      throw new Error('飞书账号未返回有效的系统会话');
    }
    clearTokenFromLocation();
    return result;
  }

  global.XlyqWorkflowSession = {
    establishFromLocation,
    store,
  };
})(window);
