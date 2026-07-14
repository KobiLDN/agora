// Agora desktop app — main process.
//
// One window: the console UI (header, log panel, interject bar) is the
// window's own page, and the two AI sites live in WebContentsViews layered
// into the empty central region the UI leaves for them. WebContentsViews are
// separate top-level browsing contexts, NOT iframes — X-Frame-Options /
// frame-ancestors does not apply to them, which is the whole reason this app
// can show live panels where the extension's console (#16) could only show
// a captured log.

const { app, BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('path');
const { Store } = require('./lib/store');
const { Bridge } = require('./lib/bridge');

const SITES = {
  DeepSeek: { url: 'https://chat.deepseek.com', partition: 'persist:agora-deepseek' },
  Claude: { url: 'https://claude.ai', partition: 'persist:agora-claude' }
};

// Must match the CSS layout in ui/console.html
const HEADER_H = 56;
const FOOTER_H = 76;
const LOG_W = 360;

let win = null;
const views = {};
let store = null;
// remembered so the renderer can be told current status when it (re)loads,
// not only via the live event it might miss during startup
const siteReady = { DeepSeek: false, Claude: false };

// A plain-Chrome user-agent. Electron's default UA advertises "Electron/x"
// and the app name, which sites (DeepSeek notably) scan for and block as an
// "abnormal usage environment". Stripping those tokens makes each panel look
// like an ordinary Chrome tab.
function cleanUserAgent(defaultUA) {
  return defaultUA
    .replace(/ Electron\/[\d.]+/i, '')
    .replace(new RegExp(' ' + app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\/[\\d.]+', 'i'), '')
    .replace(/ agora-app\/[\d.]+/i, '')
    .trim();
}

function otherSite(name) {
  return name === 'DeepSeek' ? 'Claude' : name === 'Claude' ? 'DeepSeek' : null;
}

function sendToSite(name, text) {
  const view = views[name];
  if (!view || view.webContents.isDestroyed() || view.webContents.isLoading()) return false;
  view.webContents.send('site:inject', text);
  return true;
}

function layoutViews() {
  if (!win) return;
  const [w, h] = win.getContentSize();
  const x = LOG_W;
  const y = HEADER_H;
  const areaW = Math.max(0, w - LOG_W);
  const areaH = Math.max(0, h - HEADER_H - FOOTER_H);
  const half = Math.floor(areaW / 2);

  views.DeepSeek?.setBounds({ x, y, width: half, height: areaH });
  views.Claude?.setBounds({ x: x + half, y, width: areaW - half, height: areaH });
}

function createSiteViews() {
  for (const [name, cfg] of Object.entries(SITES)) {
    const view = new WebContentsView({
      webPreferences: {
        partition: cfg.partition,
        preload: path.join(__dirname, 'preload', 'site.js'),
        contextIsolation: true,
        nodeIntegration: false,
        additionalArguments: [`--agora-site=${name}`]
      }
    });
    win.contentView.addChildView(view);
    view.webContents.setUserAgent(cleanUserAgent(view.webContents.getUserAgent()));
    view.webContents.loadURL(cfg.url);

    // drive the header status dot: green once loaded, red while (re)loading.
    // did-stop-loading is the reliable "done" signal for SPAs like Claude
    // that keep doing internal navigations after the first did-finish-load.
    view.webContents.on('did-finish-load', () => sendSiteStatus(name, true));
    view.webContents.on('did-stop-loading', () => sendSiteStatus(name, true));
    view.webContents.on('did-start-loading', () => sendSiteStatus(name, false));
    view.webContents.on('did-fail-load', () => sendSiteStatus(name, false));

    // external links (docs, OAuth-to-browser, etc.) open in the real browser
    view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    views[name] = view;
  }
}

function sendSiteStatus(name, ready) {
  siteReady[name] = ready;
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('siteStatus', { name, ready });
  }
}

// Re-emit both panels' current status — called when the console UI (re)loads,
// so it never depends on having caught the live event during startup
function resendAllSiteStatus() {
  for (const [name, ready] of Object.entries(siteReady)) {
    if (win && !win.webContents.isDestroyed()) {
      win.webContents.send('siteStatus', { name, ready });
    }
  }
}

function pushState() {
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('state', store.get());
  }
}

function wireConsoleIpc() {
  ipcMain.handle('console:getState', () => store.get());

  ipcMain.on('console:reloadSite', (e, name) => {
    views[name]?.webContents.reload();
  });

  ipcMain.on('console:devtoolsSite', (e, name) => {
    views[name]?.webContents.openDevTools({ mode: 'detach' });
  });

  // Debug snapshot: ask each site preload what it currently sees, with a
  // timeout so a dead panel can't hang the report
  ipcMain.handle('console:debugSnapshot', async () => {
    const report = {
      generatedAt: new Date().toISOString(),
      bridgeState: (() => {
        const { conversationLog, ...rest } = store.get();
        return { ...rest, logLength: conversationLog.length };
      })(),
      sites: {}
    };

    await Promise.all(Object.entries(views).map(([name, view]) => {
      return new Promise((resolve) => {
        if (!view || view.webContents.isDestroyed()) {
          report.sites[name] = { error: 'view destroyed' };
          return resolve();
        }
        const reqId = `${name}-${Date.now()}`;
        const timer = setTimeout(() => {
          ipcMain.removeAllListeners(`site:debugSnapshot:${reqId}`);
          report.sites[name] = { error: 'no response from panel (still loading?)' };
          resolve();
        }, 3000);
        ipcMain.once(`site:debugSnapshot:${reqId}`, (e, snapshot) => {
          clearTimeout(timer);
          report.sites[name] = snapshot;
          resolve();
        });
        view.webContents.send('site:debugSnapshot', reqId);
      });
    }));

    return report;
  });
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'));

  win = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#141414',
    title: 'Agora',
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'console.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'ui', 'console.html'));
  createSiteViews();
  layoutViews();
  win.on('resize', layoutViews);

  new Bridge(store, sendToSite, otherSite);
  store.onChange(pushState);

  // When the bridge flips OFF→ON, tell both panels to treat their current
  // on-screen history as already-seen, so pre-existing chat isn't captured
  // and forwarded as if it were new.
  let prevBridgeActive = store.get().bridgeActive;
  store.onChange((state) => {
    if (state.bridgeActive && !prevBridgeActive) {
      for (const view of Object.values(views)) {
        if (view && !view.webContents.isDestroyed()) {
          view.webContents.send('site:rebaseline');
        }
      }
    }
    prevBridgeActive = state.bridgeActive;
  });
  win.webContents.on('did-finish-load', () => {
    pushState();
    resendAllSiteStatus();
  });
  wireConsoleIpc();

  win.on('closed', () => {
    store.flush();
    win = null;
  });
});

app.on('window-all-closed', () => {
  store?.flush();
  app.quit();
});
