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
  let cachedName = null, backgroundRequest = 0, video = null;
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
    document.documentElement.style.setProperty('--glass-bleed', (percent * .72).toFixed(2) + 'px');
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
    if (['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'gif';
    if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.readUInt32BE(0) >= 16) return 'mp4';
    throw new Error('Choose a PNG, JPEG, WebP, GIF or MP4 file.');
  }
  async function inspect(file) {
    const fs = require('fs'), info = await fs.promises.stat(file);
    if (!info.isFile() || info.size < 4) throw new Error('Choose a valid background file.');
    const handle = await fs.promises.open(file, 'r');
    const header = Buffer.alloc(32);
    try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
    const type = imageType(header), limit = (type === 'mp4' ? 128 : 12) * 1024 * 1024;
    if (info.size > limit) throw new Error(type === 'mp4' ? 'Choose a video up to 128 MB.' : 'Choose an image up to 12 MB.');
    return { type, limit };
  }
  function digest(file, limit) {
    return new Promise((resolve, reject) => {
      const hash = require('crypto').createHash('sha256'), input = require('fs').createReadStream(file);
      let size = 0;
      input.on('data', bytes => {
        size += bytes.length;
        if (size > limit) input.destroy(new Error('The background file exceeds the size limit.'));
        else hash.update(bytes);
      });
      input.on('error', reject);
      input.on('end', () => resolve(hash.digest('hex')));
    });
  }
  function decode(file, type) {
    return new Promise((resolve, reject) => {
      const movie = type === 'mp4', media = movie ? document.createElement('video') : new Image();
      const timeout = setTimeout(() => finish(new Error('The background could not be loaded in time.')), 15000);
      function finish(error) {
        clearTimeout(timeout); media.onload = media.onerror = media.onloadedmetadata = null;
        if (movie) { media.removeAttribute('src'); media.load(); } else media.src = '';
        if (error) reject(error); else resolve();
      }
      media.onerror = () => finish(new Error(movie ? 'This MP4 cannot be played. Try an H.264 MP4 video.' : 'The selected image could not be decoded.'));
      const ready = () => {
        const width = movie ? media.videoWidth : media.naturalWidth, height = movie ? media.videoHeight : media.naturalHeight;
        const max = movie ? 4096 : 10000;
        finish(!width || !height || width > max || height > max ? new Error('Choose ' + (movie ? 'a video up to 4,096' : 'an image up to 10,000') + ' pixels per side.') : null);
      };
      if (movie) { media.preload = 'metadata'; media.muted = true; media.onloadedmetadata = ready; }
      else media.onload = ready;
      media.src = require('url').pathToFileURL(file).href;
    });
  }
  async function selectBackground(selected) {
    const fs = require('fs'), path = require('path');
    if (typeof selected !== 'string' || !path.isAbsolute(selected)) throw new Error('No background file selected.');
    const file = await fs.promises.realpath(selected), info = await inspect(file);
    await decode(file, info.type);
    const name = await digest(file, info.limit) + '.' + info.type;
    const directory = assetDirectory(), target = path.join(directory, name);
    await fs.promises.mkdir(directory, { recursive: true });
    let created = false;
    try { await fs.promises.copyFile(file, target, fs.constants.COPYFILE_EXCL); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    try {
      if (await digest(target, info.limit) + '.' + info.type !== name) throw new Error('The background changed while being copied. Select it again.');
      await decode(target, info.type);
    } catch (error) { if (created) await fs.promises.unlink(target).catch(() => {}); throw error; }
    cachedName = null;
    return name;
  }
  function clearVideo() {
    document.body.classList.remove('has-video-background');
    if (!video) return;
    video.onerror = null; video.pause(); video.removeAttribute('src'); video.load(); video.remove(); video = null;
  }
  function videoMotion() {
    if (!video) return;
    if (document.hidden || !document.body.classList.contains('glass-ui')) video.pause();
    else video.play().catch(() => {});
  }
  async function background(name) {
    const selected = typeof name === 'string' && /^[a-f0-9]{64}\.(png|jpg|webp|gif|mp4)$/.test(name) ? name : '';
    if (cachedName === selected) return;
    cachedName = selected; const request = ++backgroundRequest;
    clearVideo();
    document.documentElement.style.removeProperty('--glass-wallpaper');
    if (!selected) return;
    try {
      const path = require('path'), file = path.join(assetDirectory(), selected);
      const info = await inspect(file);
      if (await digest(file, info.limit) + '.' + info.type !== selected || request !== backgroundRequest) return;
      await decode(file, info.type);
      if (request !== backgroundRequest) return;
      const url = require('url').pathToFileURL(file).href;
      if (info.type === 'mp4') {
        video = document.createElement('video'); video.className = 'glass-video';
        video.setAttribute('aria-hidden', 'true'); video.muted = true; video.defaultMuted = true;
        video.loop = true; video.playsInline = true; video.preload = 'auto';
        video.onerror = () => { clearVideo(); };
        video.src = url; document.body.prepend(video); document.body.classList.add('has-video-background'); videoMotion();
      } else document.documentElement.style.setProperty('--glass-wallpaper', 'url("' + url + '")');
    } catch (_) { /* Missing or unsupported personal media use the built-in background. */ }
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
    videoMotion();
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
  document.addEventListener('visibilitychange', videoMotion);
  window.addEventListener('pagehide', () => { ++backgroundRequest; clearVideo(); });
  return { themes, theme, glassLevel, blurLevel, previewGlass, previewBlur, selectBackground, apply, saved, motion };
})();
