'use strict';
const { ipcRenderer, remote } = require('electron');
try { const gui = window.ToolboxAppearance.saved(); window.ToolboxAppearance.apply(gui, remote.getCurrentWindow()); document.body.classList.toggle('logo-static', gui.animatedLogo === false); } catch (_) {}
ipcRenderer.on('caption', (_, value) => { document.getElementById('caption').textContent = String(value); });
ipcRenderer.on('info', (_, value) => { document.getElementById('info').textContent = String(value); });
function motion() {
  document.body.classList.toggle('motion-paused', document.hidden);
  window.ToolboxAppearance.motion(document.hidden || document.body.classList.contains('logo-static'));
}
document.addEventListener('visibilitychange', motion);
motion();
