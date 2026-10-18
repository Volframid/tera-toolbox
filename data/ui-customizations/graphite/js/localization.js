'use strict';

// Bind only the original UI markup. Module metadata and log output are never
// scanned or translated; dynamically created UI text calls t() explicitly.
window.ToolboxLocale = (() => {
  const fs = require('fs'), path = require('path');
  const messages = JSON.parse(fs.readFileSync(path.join(__dirname, 'js', 'locales.json'), 'utf8'));
  const languages = ['ar', 'ba', 'de', 'en', 'es', 'it', 'pl', 'pt-BR', 'ru', 'tr', 'zh'];
  const bindings = [];
  let language = 'en';
  function normalize(value) {
    return languages.find(id => id.toLowerCase() === String(value || '').toLowerCase()) || 'en';
  }
  function t(key, values) {
    const translated = language !== 'en' && messages[key] && messages[key][language];
    // A callback keeps dollar signs in names from becoming replacement patterns.
    return String(translated || key).replace(/\{(\w+)\}/g, (token, name) => values && Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement && !node.parentElement.closest('script,style,svg') && messages[node.nodeValue.trim()] ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  while (walker.nextNode()) {
    const node = walker.currentNode, value = node.nodeValue, key = value.trim();
    bindings.push(() => { if (node.isConnected) node.nodeValue = value.replace(key, () => t(key)); });
  }
  for (const element of document.querySelectorAll('[title],[aria-label],[placeholder]')) {
    for (const attribute of ['title','aria-label','placeholder']) {
      const key = element.getAttribute(attribute);
      if (messages[key]) bindings.push(() => { if (element.isConnected) element.setAttribute(attribute, t(key)); });
    }
  }
  function setLanguage(value) {
    language = normalize(value);
    document.documentElement.lang = language === 'ba' ? 'bs' : language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    bindings.forEach(apply => apply());
    return language;
  }
  let saved = 'en';
  try {
    const config = path.resolve(__dirname, '..', '..', '..', 'config.json');
    if (fs.statSync(config).size <= 1048576) saved = JSON.parse(fs.readFileSync(config, 'utf8')).uilanguage;
  } catch (_) { /* Fresh portable installs receive their language through IPC. */ }
  setLanguage(saved);
  return Object.freeze({ t, setLanguage, normalize, languages: Object.freeze(languages.slice()), get language() { return language; } });
})();
