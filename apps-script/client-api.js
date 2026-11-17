async function api(path, data) {
  const pending = api.pendingRequests || (api.pendingRequests = new Map());
  const fingerprint = JSON.stringify([path, data]);
  const mutating = !['state', 'lookup', 'login', 'logout'].includes(path);
  let requestId = pending.get(fingerprint);
  if (mutating && !requestId) {
    requestId = crypto.randomUUID();
    pending.set(fingerprint, requestId);
  }
  const result = await new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(() => reject(new Error(
        '連線中斷，請稍後重試；相同內容重送不會重複登記。'
      )))
      .api({
        path,
        input: data || {},
        token: api.teacherSession || '',
        requestId: requestId || ''
      });
  });
  if (!result.ok) {
    if (mutating && result.status < 500) pending.delete(fingerprint);
    throw new Error(result.error || '服務暫時無法處理。');
  }
  if (mutating) pending.delete(fingerprint);
  if (path === 'login' && result.data.token) {
    api.teacherSession = result.data.token;
  }
  if (path === 'logout') api.teacherSession = '';
  if (result.warning) toast(result.warning, true);
  return result.data;
}
