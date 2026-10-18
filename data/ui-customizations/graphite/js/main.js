'use strict';

const { remote, ipcRenderer, shell } = require('electron');
const { TeraToolboxMUI, LanguageNames } = require('tera-toolbox-mui');
const fs = require('fs');
const appearance = window.ToolboxAppearance;
const locale = window.ToolboxLocale, t = locale.t;
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const state = { page: 'modules', discover: false, mods: [], available: [], catalog: 'idle',
  config: null, running: false, starting: false, stopping: false, busy: false, pending: false,
  updateAvailable: false, logs: [], logTimer: null, actionTimer: null, toastTimer: null, view: 'list' };
let mui = new TeraToolboxMUI('en'), lastFocus = null;
let backgroundSelection = 0;

function node(tag, className, text) {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text != null) value.textContent = String(text);
  return value;
}
function icon(name) {
  const svg = document.createElementNS(NS, 'svg'), use = document.createElementNS(NS, 'use');
  use.setAttribute('href', '#i-' + name); svg.setAttribute('aria-hidden', 'true'); svg.appendChild(use); return svg;
}
function button(text, className, callback) {
  const value = node('button', className, text); value.type = 'button'; value.addEventListener('click', callback); return value;
}
function clear(value) { while (value.firstChild) value.removeChild(value.firstChild); }
function nameOf(mod) { return String(mod.options && (mod.options.guiName || mod.options.cliName) || mod.rawName || mod.name || t('Unnamed module')); }
function friendlyError(error) { return t(error && error.message || String(error)); }
function translate(key, fallback) { try { return mui.get(key); } catch (_) { return fallback; } }
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}
function external(url) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) throw Error(t('Only web links can be opened.'));
    Promise.resolve(shell.openExternal(parsed.href)).catch(error => toast(friendlyError(error)));
  } catch (error) { toast(friendlyError(error)); }
}
function closeModal() { $('modal').hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
function modal(title, content, actions) {
  lastFocus = document.activeElement; $('modal-title').textContent = title;
  clear($('modal-body')); if (typeof content === 'string') $('modal-body').textContent = content; else $('modal-body').appendChild(content);
  clear($('modal-actions'));
  for (const action of actions || [{ label: t('Close') }]) $('modal-actions').appendChild(button(action.label, 'button ' + (action.className || ''), () => { closeModal(); if (action.run) action.run(); }));
  $('modal').hidden = false; $('modal-close').focus();
}
function closeMenu() { $('action-menu').hidden = true; }
function setPage(page) {
  if (!['modules', 'overview', 'console', 'settings'].includes(page)) return;
  state.page = page; closeMenu();
  document.querySelectorAll('.page').forEach(value => { const active = value.id === 'page-' + page; value.hidden = !active; value.classList.toggle('active', active); });
  document.querySelectorAll('.nav-button').forEach(value => { const active = value.dataset.page === page; value.classList.toggle('active', active); if (active) value.setAttribute('aria-current', 'page'); else value.removeAttribute('aria-current'); });
  if (page === 'modules') { if (!state.discover) ipcRenderer.send('get mods'); renderModules(); }
  if (page === 'settings') ipcRenderer.send('get config');
  if (page === 'overview') { ipcRenderer.send('get mods'); renderOverview(); }
  if (page === 'console') renderLogs();
}
function setProxy() {
  const busy = state.starting || state.stopping;
  const status = state.starting ? t('Starting...') : state.stopping ? t('Stopping...') : state.running ? t('Toolbox running') : t('Toolbox stopped');
  $('proxy-state').textContent = status;
  $('proxy-dot').className = 'status-dot ' + (busy ? 'busy' : state.running ? 'running' : '');
  $('startproxy').textContent = state.starting ? t('Starting...') : state.stopping ? t('Stopping...') : state.running ? t('Stop Toolbox') : t('Start Toolbox');
  $('startproxy-btn').disabled = busy || !state.config;
  $('proxy-icon').firstElementChild.setAttribute('href', '#i-' + (state.running ? 'stop' : 'play'));
  renderOverview();
}
function toggleProxy() {
  if (!state.config || state.starting || state.stopping) return;
  if (state.running) { state.stopping = true; setProxy(); ipcRenderer.send('stop proxy'); }
  else {
    if (state.config.gui.cleanstart) { state.logs = []; renderLogs(); }
    state.starting = true; setProxy(); setPage('console'); ipcRenderer.send('start proxy');
  }
}
function moduleIcon(mod) {
  const name = String(mod.name || mod.rawName || '').toLowerCase();
  if (/lancer|warrior|berserk|ninja|slayer/.test(name)) return 'swords';
  if (/lotus/.test(name)) return 'lotus';
  if (/buff|item|potion/.test(name)) return 'flask';
  if (/notify/.test(name)) return 'bell';
  if (/cache|inventory/.test(name)) return 'box';
  if (/setting|vault/.test(name)) return 'settings';
  if (/chat|translate|message/.test(name)) return 'chat';
  return 'grid';
}
function startAction(channel, mod) {
  if (state.busy) return;
  if (['install mod', 'uninstall mod'].includes(channel) && (state.running || state.starting || state.stopping)) {
    modal(t('Stop Toolbox first'), t('Install or remove modules after stopping Toolbox. This keeps the running session intact.')); return;
  }
  state.busy = true;
  clearTimeout(state.actionTimer);
  state.actionTimer = setTimeout(() => { state.busy = false; renderModules(); toast(t('No confirmation received. Refresh the list or check the console.')); }, 15000);
  renderModules();
  ipcRenderer.send(channel, mod);
  if (channel === 'toggle mod load' && state.running) { state.pending = true; toast(t('Load preference saved for the next Toolbox start.')); }
}
function finishAction() { state.busy = false; clearTimeout(state.actionTimer); state.actionTimer = null; }
function showModuleMenu(mod, anchor) {
  const menu = $('action-menu'); clear(menu);
  const meta = node('div', 'menu-meta', nameOf(mod) + (mod.version ? '\n' + t('Version') + ' ' + mod.version : '') + (mod.author ? '\n' + t('Author') + ': ' + mod.author : ''));
  menu.appendChild(meta);
  menu.appendChild(button(t('Module details'), '', () => { closeMenu(); modal(nameOf(mod), String(mod.description || t('No description provided.')) + '\n\n' + (mod.version ? t('Version') + ': ' + mod.version + '\n' : '') + (mod.author ? t('Author') + ': ' + mod.author + '\n' : '') + (mod.isCoreModule ? t('Core Toolbox module.') : t('Load toggles control the next Toolbox start.'))); }));
  if (mod.readmePath) menu.appendChild(button(t('Open README'), '', () => { closeMenu(); ipcRenderer.send('open in notepad', mod.readmePath); }));
  if (mod.supportUrl) menu.appendChild(button(t('Support / repository'), '', () => { closeMenu(); external(mod.supportUrl); }));
  if (mod.donationUrl) menu.appendChild(button(t('Support the author'), '', () => { closeMenu(); external(mod.donationUrl); }));
  if (!state.discover && !mod.isCoreModule) menu.appendChild(button(t('Remove module'), 'destructive', () => { closeMenu(); modal(t('Remove {name}?', { name: nameOf(mod) }), t('This uses Toolbox’s normal module removal. Back up any module data you want to keep.'), [{ label: t('Cancel') }, { label: t('Remove'), className: 'danger', run: () => startAction('uninstall mod', mod) }]); }));
  menu.hidden = false;
  const bounds = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(innerWidth - 213, bounds.right - 205)) + 'px';
  menu.style.top = Math.max(36, Math.min(innerHeight - menu.offsetHeight - 8, bounds.bottom + 5)) + 'px';
  const first = menu.querySelector('button'); if (first) first.focus();
}
function matches(mod) {
  const search = $('module-search').value.toLowerCase().trim();
  if (search && !(nameOf(mod) + ' ' + (mod.name || '') + ' ' + (mod.description || '') + ' ' + (mod.author || '')).toLowerCase().includes(search)) return false;
  const filter = $('module-filter').value;
  return state.discover || filter === 'all' || filter === 'enabled' && !mod.disabled || filter === 'disabled' && !!mod.disabled || filter === 'updates-off' && !!mod.disableAutoUpdate;
}
function emptyModules(title, description) {
  const empty = node('div', 'empty-state'); empty.appendChild(icon('box')); empty.appendChild(node('strong', '', title)); empty.appendChild(node('p', '', description)); $('module-list').appendChild(empty);
}
function renderModules() {
  const list = $('module-list'); clear(list); closeMenu();
  list.classList.toggle('grid-view', state.view === 'grid');
  const source = state.discover ? state.available : state.mods;
  const items = source.filter(matches).slice().sort((a, b) => Number(!!a.isCoreModule) - Number(!!b.isCoreModule) || nameOf(a).localeCompare(nameOf(b)));
  $('status-column').textContent = state.discover ? '' : t('STATUS'); $('update-column').textContent = state.discover ? '' : t('AUTO UPDATE');
  for (const mod of items) {
    const row = node('div', 'module-row'); row.dataset.name = String(mod.name || mod.rawName || '');
    const identity = node('div', 'module-identity'), image = node('div', 'module-icon'); image.appendChild(icon(moduleIcon(mod))); identity.appendChild(image);
    const copy = node('div', 'module-copy'), title = node('div', 'module-name', nameOf(mod)); title.title = nameOf(mod);
    const description = node('div', 'module-description', mod.description || (mod.isCoreModule ? t('Core Toolbox module') : t('Toolbox module'))); description.title = String(mod.description || '');
    copy.appendChild(title); copy.appendChild(description); identity.appendChild(copy); row.appendChild(identity);
    if (state.discover) {
      const install = button(t('Install'), 'button primary install-button', () => startAction('install mod', mod)); install.disabled = state.busy; row.appendChild(install);
      const details = button('', 'icon-button module-menu', event => showModuleMenu(mod, event.currentTarget)); details.appendChild(icon('more')); details.setAttribute('aria-label', t('{name} details', { name: nameOf(mod) })); row.appendChild(details);
    } else {
      const compatible = mod.compatibility === 'compatible';
      const status = button('', 'module-status' + (mod.disabled ? ' disabled' : '') + (!compatible ? ' unsupported' : ''), () => startAction('toggle mod load', mod));
      const dot = node('span', 'status-dot'); status.appendChild(dot); status.appendChild(node('span', '', mod.isCoreModule ? t('Core') : !compatible ? t('Legacy') : mod.disabled ? t('Disabled') : t('Enabled')));
      status.disabled = state.busy || !!mod.isCoreModule || !compatible;
      status.title = mod.isCoreModule ? t('Required Toolbox module') : t('Configured load preference; changes apply at the next Toolbox start.');
      status.setAttribute('aria-label', t('Toggle loading for {name}', { name: nameOf(mod) })); status.setAttribute('aria-pressed', String(!mod.disabled)); row.appendChild(status);
      if (compatible && !mod.isCoreModule) {
        const update = button('', 'switch', () => startAction('toggle mod autoupdate', mod)); update.setAttribute('role', 'switch'); update.setAttribute('aria-checked', String(!mod.disableAutoUpdate)); update.setAttribute('aria-label', t('Automatic updates for {name}', { name: nameOf(mod) })); update.title = t('Automatic module updates'); update.disabled = state.busy; row.appendChild(update);
      } else row.appendChild(node('span', 'switch-label', mod.isCoreModule ? t('Managed') : '—'));
      const more = button('', 'icon-button module-menu', event => showModuleMenu(mod, event.currentTarget)); more.appendChild(icon('more')); more.setAttribute('aria-label', t('Actions for {name}', { name: nameOf(mod) })); more.disabled = state.busy; row.appendChild(more);
    }
    list.appendChild(row);
  }
  if (!items.length) emptyModules(state.discover && state.catalog === 'loading' ? t('Finding modules...') : t('No modules to show'), state.discover && state.catalog === 'loading' ? t('Loading the Toolbox module catalog.') : state.discover && state.catalog === 'error' ? t('The catalog could not be loaded. Check your connection and try Refresh.') : t('Try a different search or filter.'));
  $('module-count').textContent = t(items.length !== source.length ? '{count} of {total} modules' : items.length === 1 ? '{count} module' : '{count} modules', { count: items.length, total: source.length });
  renderUpdateState();
}
function renderUpdateState() {
  const container = $('update-state'); clear(container);
  const dot = node('span', 'status-dot ' + (state.updateAvailable || state.pending ? 'busy' : 'neutral')); container.appendChild(dot);
  container.appendChild(node('span', '', state.updateAvailable ? t('Toolbox update available') : state.pending ? t('Load changes apply next start') : state.config && state.config.noupdate ? t('Module updates disabled') : t('Updates checked at startup')));
}
function setCatalog(discover, refresh) {
  state.discover = discover; $('installed-tab').classList.toggle('selected', !discover); $('discover-tab').classList.toggle('selected', discover);
  $('installed-tab').setAttribute('aria-pressed', String(!discover)); $('discover-tab').setAttribute('aria-pressed', String(discover));
  $('module-filter').disabled = discover;
  if (discover && (refresh || state.catalog === 'idle' || state.catalog === 'error')) { state.catalog = 'loading'; ipcRenderer.send('get installable mods'); }
  else if (!discover) ipcRenderer.send('get mods');
  renderModules();
}
function renderOverview() {
  $('overview-status').textContent = state.starting ? t('Starting') : state.stopping ? t('Stopping') : state.running ? t('Running') : t('Stopped');
  $('overview-status-note').textContent = state.running ? t('Proxy is active.') : t('Ready when you are.');
  $('overview-modules').textContent = String(state.mods.length);
  $('overview-enabled').textContent = t('{count} configured to load.', { count: state.mods.filter(mod => !mod.disabled).length });
  $('overview-updates').textContent = !state.config ? '—' : state.config.noupdate ? t('Off') : t('On');
  const eligible = state.mods.filter(mod => !mod.isCoreModule && mod.compatibility === 'compatible');
  $('overview-update-note').textContent = t('{count} of {total} modules allow automatic updates.', { count: eligible.filter(mod => !mod.disableAutoUpdate).length, total: eligible.length });
  if (state.page !== 'overview') return;
  const recent = $('recent-activity'); clear(recent);
  if (!state.logs.length) recent.appendChild(node('p', 'quiet-empty', t('Activity appears here when Toolbox writes to the console.')));
  for (const entry of state.logs.slice(-6).reverse()) { const row = node('div', 'recent-row ' + entry.type); row.appendChild(node('time', '', entry.time)); row.appendChild(node('span', '', entry.text)); recent.appendChild(row); }
}
function logTime(date) { return [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':'); }
function addLog(data, type) {
  const date = new Date(), level = ['error', 'warn'].includes(type) ? type : 'log';
  const raw = String(data == null ? '' : data).replace(/\u001b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n').trimEnd();
  if (!raw) return;
  state.logs.push({ text: raw, type: level, time: logTime(date) });
  if (state.logs.length > 2000) state.logs.splice(0, state.logs.length - 2000);
  if (state.logTimer === null) state.logTimer = setTimeout(() => {
    state.logTimer = null;
    const count = state.logs.filter(entry => entry.type !== 'log').length; $('warning-count').hidden = !count; $('warning-count').textContent = String(count);
    if (state.page === 'console') renderLogs();
    if (state.page === 'overview') renderOverview();
  }, 160);
}
function renderLogs() {
  const query = $('log-search').value.toLowerCase(), filter = $('log-filter').value;
  const rows = state.logs.filter(entry => (filter === 'all' || entry.type === filter) && entry.text.toLowerCase().includes(query));
  const container = $('log-contents'), top = container.scrollTop; clear(container);
  const fragment = document.createDocumentFragment();
  for (const entry of rows) { const row = node('div', 'log-row ' + entry.type); if (!state.config || state.config.gui.logtimes) row.appendChild(node('time', '', entry.time)); row.appendChild(node('span', '', entry.text)); fragment.appendChild(row); }
  container.appendChild(fragment); container.scrollTop = $('log-follow').checked ? container.scrollHeight : top;
  $('log-count').textContent = t('{count} of {total} entries', { count: rows.length, total: state.logs.length });
}
const SETTINGS = [
  { title: 'Appearance & window', rows: [
    ['uilanguage', 'Toolbox language', 'Language used by Toolbox messages and module dialogs.', 'language'],
    ['theme', 'Theme', 'Apply colors to Toolbox and newly opened module settings windows.', 'theme', true],
    ['glassEnabled', 'Glassy UI', 'Clear or frosted panels over your wallpaper. Text and icons stay sharp.', 'toggle', true],
    ['glassTransparency', 'Glass transparency', 'Adjust panel transparency. Preview instantly; release to save.', 'range', true],
    ['glassBlur', 'Background blur', 'Blur the entire background, including gaps and edges. Text and controls stay sharp.', 'blur', true],
    ['glassBackground', 'Background', 'Choose a PNG, JPEG, WebP, GIF or MP4. Videos play silently on repeat.', 'background', true],
    ['animatedLogo', 'Animated logo', 'Flowing energy, liquid waves and luminous trails inside the cube.', 'toggle', true],
    ['minimizetotray', 'Minimize to tray', 'Keep Toolbox available in the system tray when minimized.', 'toggle', true]
  ] },
  { title: 'Startup & console', rows: [
    ['autostart', 'Start automatically', 'Start the proxy when Toolbox opens.', 'toggle', true],
    ['logtimes', 'Show timestamps', 'Show the time beside console entries.', 'toggle', true],
    ['cleanstart', 'Clear console on start', 'Clear the current window’s console before a manual start.', 'toggle', true],
    ['updatelog', 'Detailed update output', 'Include module update details in the console.', 'toggle']
  ] },
  { title: 'Updates', rows: [
    ['noupdate', 'Automatic module updates', 'Check and download eligible module updates when the proxy starts.', 'inverse'],
    ['noselfupdate', 'Toolbox updates', 'Keep Toolbox itself updated. The custom interface is preserved.', 'inverse']
  ] },
  { title: 'Game client', rows: [
    ['noslstags', 'Server list tags', 'Show the Toolbox tag beside servers.', 'inverse'],
    ['removecounters', 'Remove server counters', 'Use the saved Toolbox server-list counter preference.', 'toggle'],
    ['noserverautojoin', 'Automatic server join', 'Use Toolbox’s automatic server selection behavior.', 'inverse']
  ] }
];
function applyLanguage(value) {
  const selected = locale.setLanguage(value);
  try { mui = new TeraToolboxMUI(selected); } catch (_) {}
  renderSettings(); renderModules(); setProxy(); renderLogs();
}
function saveSetting(key, value, gui) {
  if (!state.config) return;
  const next = { ...state.config, gui: { ...state.config.gui } };
  if (gui) next.gui[key] = value; else next[key] = value;
  state.config = next; document.body.classList.toggle('logo-static', !next.gui.animatedLogo);
  try { appearance.apply(next.gui, remote.getCurrentWindow()); } catch (error) { toast(friendlyError(error)); }
  ipcRenderer.send('set config', next);
  if (key === 'uilanguage') { applyLanguage(value); return; }
  motion(); renderSettings(); renderUpdateState(); renderOverview(); if (state.page === 'console') renderLogs();
}
function renderSettings() {
  const list = $('settings-list'), scrollTop = list.scrollTop, focus = document.activeElement && document.activeElement.id; clear(list);
  if (!state.config) { list.appendChild(node('p', 'quiet-empty', t('Loading your settings...'))); return; }
  for (const group of SETTINGS) {
    const section = node('section', 'settings-group'); section.appendChild(node('h2', '', t(group.title)));
    for (const row of group.rows) {
      const [key, labelKey, descriptionKey, kind, gui] = row;
      const label = t(labelKey), description = t(descriptionKey);
      const item = node('div', 'setting'), copy = node('div', 'setting-copy'); copy.appendChild(node('strong', '', label)); copy.appendChild(node('p', '', description)); item.appendChild(copy);
      const source = gui ? state.config.gui : state.config;
      if (['language', 'theme'].includes(kind)) {
        const select = node('select'); select.setAttribute('aria-label', label); select.id = 'setting-' + key;
        const values = kind === 'language' ? LanguageNames : appearance.themes;
        for (const [value, name] of Object.entries(values)) { const option = node('option', '', kind === 'language' ? name : t(name)); option.value = value; select.appendChild(option); }
        select.value = kind === 'language' ? locale.normalize(source[key]) : String(source[key] || 'black'); select.addEventListener('change', () => saveSetting(key, select.value, gui)); item.appendChild(select);
      } else if (kind === 'range' || kind === 'blur') {
        const blur = kind === 'blur', normalize = blur ? appearance.blurLevel : appearance.glassLevel;
        const control = node('div', 'range-setting'), range = node('input'), output = node('output');
        range.type = 'range'; range.min = '0'; range.max = blur ? '100' : '90'; range.step = '1'; range.id = 'setting-' + key;
        range.value = String(normalize(source[key])); range.setAttribute('aria-label', label);
        range.disabled = source.glassEnabled === false;
        range.setAttribute('aria-valuetext', t(blur ? '{value}% background blur' : '{value}% panel transparency', { value: range.value }));
        range.style.setProperty('--range-percent', Number(range.value) / Number(range.max) * 100 + '%');
        output.htmlFor = range.id; output.textContent = range.value + '%'; output.id = blur ? 'blur-percent' : 'glass-percent';
        range.addEventListener('input', () => {
          const value = normalize(Number(range.value)); range.style.setProperty('--range-percent', value / Number(range.max) * 100 + '%'); output.textContent = value + '%'; range.setAttribute('aria-valuetext', t(blur ? '{value}% background blur' : '{value}% panel transparency', { value }));
          if (blur) appearance.previewBlur(value); else appearance.previewGlass(value);
        });
        range.addEventListener('change', () => saveSetting(key, normalize(Number(range.value)), true));
        control.appendChild(range); control.appendChild(output);
        control.appendChild(button(t('Reset'), 'text-button', () => saveSetting(key, blur ? 0 : 55, true))); item.appendChild(control);
      } else if (kind === 'background') {
        const controls = node('div', 'background-buttons');
        controls.appendChild(button(t('Choose file'), 'button', async event => {
          const request = ++backgroundSelection, picker = event.currentTarget;
          picker.disabled = true;
          try {
            const result = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), { title: t('Choose a Toolbox background'), properties: ['openFile'], filters: [{ name: t('Images and videos'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4'] }, { name: t('Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }, { name: t('MP4 videos'), extensions: ['mp4'] }] });
            if (!result.canceled && result.filePaths && result.filePaths[0]) {
              const selected = await appearance.selectBackground(result.filePaths[0]);
              if (request === backgroundSelection) saveSetting(key, selected, true);
            }
          } catch (error) { if (request === backgroundSelection) modal(t('Could not load background'), friendlyError(error)); }
          finally { picker.disabled = false; }
        }));
        const reset = button(t('Default'), 'text-button', () => { ++backgroundSelection; saveSetting(key, '', true); }); reset.disabled = !source[key]; controls.appendChild(reset); item.appendChild(controls);
      } else {
        const enabled = kind === 'inverse' ? !source[key] : !!source[key];
        const control = button('', 'switch', () => saveSetting(key, kind === 'inverse' ? enabled : !enabled, gui));
        control.id = 'setting-' + key; control.setAttribute('role', 'switch'); control.setAttribute('aria-checked', String(enabled)); control.setAttribute('aria-label', label); item.appendChild(control);
      }
      section.appendChild(item);
    }
    list.appendChild(section);
  }
  list.scrollTop = scrollTop;
  if (focus && focus.startsWith('setting-') && $(focus)) $(focus).focus({ preventScroll: true });
}

document.querySelectorAll('[data-page]').forEach(value => value.addEventListener('click', () => setPage(value.dataset.page)));
document.querySelectorAll('[data-go]').forEach(value => value.addEventListener('click', () => setPage(value.dataset.go)));
$('startproxy-btn').addEventListener('click', toggleProxy);
$('minimize-btn').addEventListener('click', () => { const window = remote.getCurrentWindow(); if (state.config && state.config.gui.minimizetotray) window.hide(); else window.minimize(); });
$('maximize-btn').addEventListener('click', () => { const window = remote.getCurrentWindow(); if (window.isMaximized()) window.unmaximize(); else window.maximize(); });
$('close-btn').addEventListener('click', () => remote.getCurrentWindow().close());
$('support-btn').addEventListener('click', () => { try { external(remote.getGlobal('TeraProxy').SupportUrl); } catch (error) { toast(friendlyError(error)); } });
$('info-btn').addEventListener('click', () => {
  const content = node('div'); content.appendChild(node('p', '', t('TERA Toolbox · Graphite interface')));
  const credits = translate('gui/main/static/tabs/credits/content', t('Original Toolbox contributors: Caali, Pinkie Pie and meishu.'));
  // Convert bundled trusted credits to text; no module-supplied HTML is ever injected.
  const parsed = new DOMParser().parseFromString(String(credits), 'text/html');
  parsed.querySelectorAll('script,style').forEach(value => value.remove());
  content.appendChild(node('p', 'credits-note', parsed.body.textContent.trim())); modal(t('About Toolbox'), content);
});
$('mods-folder').addEventListener('click', () => ipcRenderer.send('show mods folder'));
$('module-search').addEventListener('input', renderModules); $('module-filter').addEventListener('change', renderModules);
$('installed-tab').addEventListener('click', () => setCatalog(false)); $('discover-tab').addEventListener('click', () => setCatalog(true));
$('add-module').addEventListener('click', () => setCatalog(true));
$('refresh-mods').addEventListener('click', () => { if (state.discover) setCatalog(true, true); else ipcRenderer.send('get mods'); });
for (const view of ['list', 'grid']) $('view-' + view).addEventListener('click', () => { state.view = view; for (const name of ['list', 'grid']) { $('view-' + name).classList.toggle('selected', view === name); $('view-' + name).setAttribute('aria-pressed', String(view === name)); } renderModules(); });
$('log-search').addEventListener('input', renderLogs); $('log-filter').addEventListener('change', renderLogs); $('log-follow').addEventListener('change', renderLogs);
$('clear-logs').addEventListener('click', () => { state.logs = []; $('warning-count').hidden = true; renderLogs(); renderOverview(); });
$('save-logs').addEventListener('click', async () => {
  const text = state.logs.map(entry => (state.config && state.config.gui.logtimes ? '[' + entry.time + '] ' : '') + entry.text).join('\n') + '\n';
  try {
    const chosen = await remote.dialog.showSaveDialog({ title: t('Save Toolbox console'), defaultPath: 'toolbox.log', buttonLabel: t('Save log'), filters: [{ name: t('Log files'), extensions: ['log'] }] });
    if (!chosen.canceled && chosen.filePath) await fs.promises.writeFile(chosen.filePath, text, 'utf8');
  } catch (error) { modal(t('Could not save log'), friendlyError(error)); }
});
$('modal-close').addEventListener('click', closeModal);
$('modal').addEventListener('click', event => { if (event.target === $('modal')) closeModal(); });
document.addEventListener('click', event => { if (!$('action-menu').contains(event.target) && !event.target.closest('.module-menu')) closeMenu(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { if (!$('modal').hidden) closeModal(); else closeMenu(); }
  if (event.key === 'Tab' && !$('modal').hidden) {
    const items = $('modal').querySelectorAll('button:not(:disabled),a[href],input,select'); const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && $('modal').hidden) { event.preventDefault(); if (state.page !== 'console') setPage('modules'); $(state.page === 'console' ? 'log-search' : 'module-search').focus(); }
});
window.addEventListener('resize', closeMenu);
function motion() {
  const paused = document.hidden || !document.hasFocus();
  document.body.classList.toggle('motion-paused', paused);
  appearance.motion(paused || document.body.classList.contains('logo-static'));
}
document.addEventListener('visibilitychange', motion); window.addEventListener('blur', motion); window.addEventListener('focus', motion);

ipcRenderer.on('set config', (_, config) => {
  const gui = config.gui || {}, selected = appearance.theme(gui.theme);
  state.config = { ...config, gui: { logtimes: true, animatedLogo: true, ...gui, theme: selected,
    glassEnabled: gui.glassEnabled !== false, glassTransparency: appearance.glassLevel(gui.glassTransparency), glassBlur: appearance.blurLevel(gui.glassBlur) } };
  delete state.config.gui.transparency;
  // Retire old native fade and theme names, preserving unrelated preferences and update flags.
  if (gui.theme !== selected || Object.prototype.hasOwnProperty.call(gui, 'transparency')) ipcRenderer.send('set config', state.config);
  try { appearance.apply(state.config.gui, remote.getCurrentWindow()); } catch (error) { toast(friendlyError(error)); }
  applyLanguage(config.uilanguage);
  document.body.classList.toggle('logo-static', !state.config.gui.animatedLogo);
  motion();
});
ipcRenderer.on('is admin', (_, enabled) => { $('admin-badge').hidden = !enabled; });
ipcRenderer.on('proxy starting', () => { state.starting = true; state.stopping = false; setProxy(); });
ipcRenderer.on('proxy running', (_, running) => { state.running = !!running; state.starting = false; state.stopping = false; state.pending = false; setProxy(); renderUpdateState(); });
ipcRenderer.on('update available', () => { state.updateAvailable = true; renderUpdateState(); });
ipcRenderer.on('set mods', (_, mods) => { finishAction(); state.mods = Array.isArray(mods) ? mods : []; renderModules(); renderOverview(); });
ipcRenderer.on('set installable mods', (_, mods) => { finishAction(); state.available = Array.isArray(mods) ? mods : []; state.catalog = 'ready'; renderModules(); ipcRenderer.send('get mods'); });
ipcRenderer.on('log', (_, message, type) => addLog(message, type));
ipcRenderer.on('error', (_, error) => { finishAction(); if (state.catalog === 'loading') state.catalog = 'error'; renderModules(); modal(t('Toolbox message'), friendlyError(error)); });
window.addEventListener('beforeunload', () => { clearTimeout(state.logTimer); clearTimeout(state.actionTimer); clearTimeout(state.toastTimer); });
try { appearance.apply(appearance.saved(), remote.getCurrentWindow()); } catch (_) {}
renderModules(); renderSettings(); renderLogs(); motion();
ipcRenderer.send('init');
ipcRenderer.send('get mods');
