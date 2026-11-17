// GitHub Pages 使用表單 POST 與訊息回傳，不需要將試算表公開。
function doPost(e) {
  const frontendOrigin = 'https://jush-website.github.io';
  let nonce = '';
  let result;
  try {
    const payload = e && e.parameter && e.parameter.payload;
    if (typeof payload !== 'string' || payload.length > 16000) {
      throw new Error('請求格式不正確。');
    }
    const request = JSON.parse(payload);
    nonce = String(request.replyNonce || '');
    if (!/^[a-f0-9]{32}$/.test(nonce)) {
      throw new Error('回傳識別碼不正確。');
    }
    result = api(request);
  } catch (error) {
    result = { ok: false, status: 400, error: '無法處理此請求，請重新整理後再試。' };
  }
  const message = JSON.stringify({
    kind: 'end-grouping-response',
    nonce: nonce,
    result: result
  }).replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const html = '<!doctype html><meta charset="utf-8"><script>' +
    '(function(){const message=' + message + ';' +
    'let target=window.parent;' +
    'for(let i=0;i<8;i++){' +
    'try{target.postMessage(message,' + JSON.stringify(frontendOrigin) + ');' +
    'const next=target.parent;if(next===target)break;target=next;}' +
    'catch(e){break;}}})();' +
    '</script>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
