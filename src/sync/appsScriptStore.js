/**
 * SheetStore backed by the Apps Script web app in google-apps-script/Code.gs.
 *
 * Tested against a stand-in for Google's services, not against Google:
 * the deployed script, redirects and cross-origin behaviour need a real
 * sheet to confirm.
 */

const WEB_APP_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

export function isAppsScriptUrl(url) {
  return typeof url === 'string' && WEB_APP_URL.test(url.trim());
}

/** @implements {import('../domain/sheetSync.js').SheetStore} */
export class AppsScriptStore {
  constructor(url, fetchFn = (...args) => globalThis.fetch(...args)) {
    if (!isAppsScriptUrl(url)) {
      throw new Error('That is not an Apps Script web app link (it should end in /exec).');
    }
    this.url = url.trim();
    this.fetch = fetchFn;
  }

  pull() {
    return this.request({ method: 'GET' });
  }

  push(write) {
    // text/plain keeps this a "simple" request: Apps Script cannot answer
    // the CORS preflight that application/json would trigger.
    return this.request({
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(write),
    });
  }

  async request(init) {
    const response = await this.fetch(this.url, { ...init, redirect: 'follow' });
    if (!response.ok) throw new Error(`Google Sheet link answered with HTTP ${response.status}.`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        'The link did not return sheet data. In Apps Script, deploy as a Web app with "Who has access" set to Anyone.',
      );
    }
  }
}
