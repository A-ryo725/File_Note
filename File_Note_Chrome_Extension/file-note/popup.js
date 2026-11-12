const current = document.getElementById('current');
const message = document.getElementById('message');
let source = null;
chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  try {
    const url = new URL(tab?.url || '');
    if (['http:', 'https:', 'file:'].includes(url.protocol)) source = url;
    else if (url.protocol === 'chrome-extension:' && url.searchParams.get('file')) source = new URL(url.searchParams.get('file'));
  } catch {
    /* not a usable URL: the button stays disabled below */
  }
  if (!source || !['http:', 'https:', 'file:'].includes(source.protocol)) {
    source = null;
    current.disabled = true;
    message.textContent = 'PDFをChromeで開いてから押すか、「パソコン内のファイルを選ぶ」を使ってください。';
  }
});
document.getElementById('open').onclick = () => document.getElementById('localPdf').click();
document.getElementById('localPdf').onchange = async () => {
  const file = document.getElementById('localPdf').files[0];
  document.getElementById('localPdf').value = '';
  if (!file) return;
  const button = document.getElementById('open');
  button.disabled = true;
  let token;
  try {
    message.textContent = '選択したファイルを開いています…';
    token = await queuePdf(file);
    await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') + '?transfer=' + encodeURIComponent(token) });
    window.close();
  } catch (e) {
    if (token) await consumePdf(token).catch(() => {});
    message.textContent = '開けませんでした：' + e.message;
  } finally {
    button.disabled = false;
  }
};
current.onclick = async () => {
  if (!source) return;
  try {
    if (source.protocol === 'file:') {
      if (!(await chrome.extension.isAllowedFileSchemeAccess())) {
        message.textContent = '拡張機能の詳細で「ファイルのURLへのアクセスを許可する」をオンにしてください。ファイル選択なら設定不要です。';
        return;
      }
    } else {
      const allowed = await chrome.permissions.request({ origins: [`${source.origin}/*`] });
      if (!allowed) {
        message.textContent = '読み込みが許可されませんでした。ダウンロードしたPDFをファイル選択で開けます。';
        return;
      }
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') + '?source=' + encodeURIComponent(source.href) });
    window.close();
  } catch (e) {
    message.textContent = '開けませんでした。「パソコン内のファイルを選ぶ」を使ってください。';
  }
};
import { queuePdf, consumePdf } from './transfer.js';
