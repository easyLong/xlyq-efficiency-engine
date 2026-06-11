(function attachAppShell(global) {
  const SESSION_KEY = 'mvpSession';
  const LEGACY_USER_KEY = 'mvpUser';

  async function request(input) {
    const init = {
      ...(input.options || {}),
      headers: { ...((input.options || {}).headers || {}) },
    };
    const accessToken = input.getAccessToken?.();
    if (accessToken && !init.headers.Authorization) {
      init.headers.Authorization = `Bearer ${accessToken}`;
    }
    if (init.body && typeof init.body !== 'string') {
      init.headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = JSON.stringify(init.body);
    }
    const res = await fetch(input.apiBase + input.path, init);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw new Error(data?.message || text || res.statusText);
    return data;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", '&#39;');
  }

  function readSession() {
    return localStorage.getItem(SESSION_KEY);
  }

  function writeSession(session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(LEGACY_USER_KEY);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_USER_KEY);
  }

  function readLegacyUser() {
    return localStorage.getItem(LEGACY_USER_KEY);
  }

  global.XlyqAppShell = {
    request,
    escapeHtml,
    escapeAttr,
    session: {
      read: readSession,
      readLegacyUser,
      write: writeSession,
      clear: clearSession,
    },
  };
})(window);
