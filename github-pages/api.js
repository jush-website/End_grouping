const REGISTRATION_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyK5H8cGpqpsOkl-JpD07B0FG86eLolufJd9BDiik1dB2vaEqUbq-Mxh9noRyBTYdp8/exec';
const registrationTransport = (() => {
  const active = new Map();
  const reads = new Map();
  let queue = Promise.resolve();

  function isOwnResponse(event, item) {
    if (!event.source) return false;
    let trustedOrigin = event.origin === 'null';
    try {
      const origin = new URL(event.origin);
      trustedOrigin = origin.protocol === 'https:' && (
        origin.hostname === 'script.google.com' ||
        origin.hostname === 'script.googleusercontent.com' ||
        origin.hostname.endsWith('-script.googleusercontent.com')
      );
    } catch (_) {}
    if (!trustedOrigin) return false;
    // Apps Script may run in an opaque sandbox. The response must still come
    // from this request's iframe (or its nested Google iframe) and match its nonce.
    try {
      let source = event.source;
      for (let i = 0; i < 8; i++) {
        if (source === item.frame.contentWindow) return true;
        const parent = source.parent;
        if (parent === source) break;
        source = parent;
      }
    } catch (_) {}
    return false;
  }

  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.kind !== 'end-grouping-response') return;
    const item = active.get(data.nonce);
    if (!item || !isOwnResponse(event, item)) return;
    if (!data.result || typeof data.result.ok !== 'boolean') return;
    item.finish();
    item.resolve(data.result);
  });

  function post(request) {
    return new Promise((resolve, reject) => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const nonce = Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
      const frame = document.createElement('iframe');
      frame.name = 'registration_' + nonce;
      frame.title = '登記資料連線';
      frame.hidden = true;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin');
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = REGISTRATION_ENDPOINT;
      form.target = frame.name;
      form.hidden = true;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'payload';
      input.value = JSON.stringify({ ...request, replyNonce: nonce });
      form.appendChild(input);
      let timer;
      const finish = () => {
        clearTimeout(timer);
        active.delete(nonce);
        form.remove();
        frame.remove();
      };
      active.set(nonce, { frame, resolve, finish });
      document.body.append(frame, form);
      timer = setTimeout(() => {
        finish();
        reject(new Error('暫時無法連接登記服務，請稍後重試或聯絡老師；相同內容重送不會重複登記。'));
      }, 45000);
      try { form.submit(); }
      catch (_) { finish(); reject(new Error('無法送出請求，請重新整理後再試。')); }
    });
  }

  return function request(payload) {
    const read = payload.path === 'state' || payload.path === 'lookup';
    const key = JSON.stringify([payload.path, payload.input, payload.token]);
    if (read && reads.has(key)) return reads.get(key);
    const promise = queue.then(() => post(payload));
    queue = promise.catch(() => {});
    if (read) {
      reads.set(key, promise);
      promise.then(() => reads.delete(key), () => reads.delete(key));
    }
    return promise;
  };
})();

async function api(path, data) {
  const pending = api.pendingRequests || (api.pendingRequests = new Map());
  const fingerprint = JSON.stringify([path, data]);
  const mutating = !['state', 'lookup', 'login', 'logout'].includes(path);
  let requestId = pending.get(fingerprint);
  if (mutating && !requestId) {
    requestId = crypto.randomUUID();
    pending.set(fingerprint, requestId);
  }
  const result = await registrationTransport({
    path,
    input: data || {},
    token: api.teacherSession || '',
    requestId: requestId || ''
  });
  if (!result.ok) {
    if (mutating && result.status < 500) pending.delete(fingerprint);
    throw new Error(result.error || '服務暫時無法處理。');
  }
  if (mutating) pending.delete(fingerprint);
  if (path === 'login' && result.data.token) api.teacherSession = result.data.token;
  if (path === 'logout') api.teacherSession = '';
  if (result.warning) toast(result.warning, true);
  return result.data;
}
