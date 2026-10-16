'use strict';

// Shared by the workspace and splash. Glass changes surfaces, never content opacity.
window.ToolboxAppearance = (() => {
  const themes = { black: 'Black', grey: 'Grey', white: 'White', pink: 'Pink' };
  const backgrounds = { black: '#191d22', grey: '#32363d', white: '#f4f5f8', pink: '#251b26' };
  function theme(value) {
    const name = typeof value === 'string' ? value.toLowerCase() : '';
    const aliases = { modern: 'black', 'classic-black': 'black', 'classic-white': 'white', 'classic-pink': 'pink' };
    return Object.prototype.hasOwnProperty.call(themes, name) ? name : Object.prototype.hasOwnProperty.call(aliases, name) ? aliases[name] : 'black';
  }
  let cachedName = null;
  function glassLevel(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 55;
    return Math.max(0, Math.min(90, Math.round(value)));
  }
  function blurLevel(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
  }
  function previewBlur(value) {
    const percent = blurLevel(value);
    document.documentElement.style.setProperty('--glass-filter', percent ? 'blur(' + (percent * .24).toFixed(2) + 'px)' : 'none');
    return percent;
  }
  function rgb(value) {
    let hex = String(value).trim().replace('#', '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = hex.split('').map(c => c + c).join('');
    return /^[0-9a-f]{6}$/i.test(hex) ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',') : '25,29,34';
  }
  function previewGlass(value) {
    const percent = glassLevel(value), root = document.documentElement;
    const panel = 1 - percent / 100 * .9;
    root.style.setProperty('--glass-alpha', String(theme(root.dataset.theme) === 'white' ? Math.max(.84, panel) : panel));
    return percent;
  }
  function assetDirectory() { return require('path').resolve(__dirname, '..', 'user-assets'); }
  function imageType(bytes) {
    if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
    if (bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
    if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    throw new Error('Choose a PNG, JPEG or WebP image.');
  }
  function selectBackground(selected) {
    const fs = require('fs'), path = require('path'), crypto = require('crypto');
    if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw new Error('No background image selected.');
    const file = fs.realpathSync(selected), info = fs.statSync(file);
    if (!info.isFile() || info.size < 4 || info.size > 12 * 1024 * 1024) throw new Error('Choose an image smaller than 12 MB.');
    const bytes = fs.readFileSync(file), type = imageType(bytes);
    const picture = require('electron').nativeImage.createFromBuffer(bytes);
    if (picture.isEmpty()) throw new Error('The selected image could not be decoded.');
    const size = picture.getSize();
    if (size.width > 10000 || size.height > 10000) throw new Error('Choose an image up to 10,000 pixels per side.');
    const name = crypto.createHash('sha256').update(bytes).digest('hex') + '.' + type;
    const directory = assetDirectory(), target = path.join(directory, name);
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: 'wx' });
    else if (!fs.readFileSync(target).equals(bytes)) throw new Error('The saved background does not match this image.');
    cachedName = null;
    return name;
  }
  function background(name) {
    const selected = typeof name === 'string' && /^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name) ? name : '';
    if (cachedName === selected) return;
    cachedName = selected;
    document.documentElement.style.removeProperty('--glass-wallpaper');
    if (!selected) return;
    try {
      const fs = require('fs'), path = require('path'), file = path.join(assetDirectory(), selected);
      if (fs.statSync(file).size > 12 * 1024 * 1024) return;
      const bytes = fs.readFileSync(file), type = imageType(bytes);
      if (require('crypto').createHash('sha256').update(bytes).digest('hex') + '.' + type !== selected) return;
      const mime = type === 'jpg' ? 'jpeg' : type;
      document.documentElement.style.setProperty('--glass-wallpaper', 'url("data:image/' + mime + ';base64,' + bytes.toString('base64') + '")');
    } catch (_) { /* Missing personal images use the built-in background. */ }
  }
  function apply(gui, handle) {
    gui = gui || {};
    const root = document.documentElement, selected = theme(gui.theme);
    root.dataset.theme = selected;
    if (handle && typeof handle.setOpacity === 'function') handle.setOpacity(1);
    if (handle && typeof handle.setBackgroundColor === 'function') handle.setBackgroundColor(backgrounds[selected]);
    const colors = getComputedStyle(root);
    root.style.setProperty('--glass-panel-rgb', rgb(backgrounds[selected]));
    root.style.setProperty('--glass-sidebar-rgb', rgb(colors.getPropertyValue('--sidebar')));
    root.style.setProperty('--glass-surface-rgb', rgb(colors.getPropertyValue('--surface')));
    document.body.classList.toggle('glass-ui', gui.glassEnabled !== false);
    previewGlass(gui.glassTransparency); previewBlur(gui.glassBlur); background(gui.glassBackground);
    return selected;
  }
  function saved() {
    try {
      const fs = require('fs'), path = require('path');
      const file = path.resolve(__dirname, '..', '..', '..', 'config.json');
      if (fs.statSync(file).size > 1048576) return {};
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      return config && config.gui && typeof config.gui === 'object' ? config.gui : {};
    } catch (_) { return {}; }
  }
  function motion(paused) {
    document.querySelectorAll('.brand-cube svg').forEach(svg => {
      if (paused) svg.pauseAnimations(); else svg.unpauseAnimations();
    });
  }
  return { themes, theme, glassLevel, blurLevel, previewGlass, previewBlur, selectBackground, apply, saved, motion };
})();
