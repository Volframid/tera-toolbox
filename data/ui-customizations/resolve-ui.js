'use strict';
const fs = require('fs'), path = require('path');
module.exports = function resolveUI(bin) {
  const root = path.join(bin, '..', 'data', 'ui-customizations', 'graphite');
  const complete = ['main.html', 'js/main.js', 'js/appearance.js', 'css/main.css', 'css/themes.css', 'css/glass.css', 'css/energy.css', 'assets/glass-background.svg', 'splash.html', 'js/splash.js', 'css/splash.css']
    .every(file => fs.existsSync(path.join(root, file)));
  return complete ? root : path.join(bin, 'gui');
};
