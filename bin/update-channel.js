'use strict';

const channel = 'https://raw.githubusercontent.com/Volframid/tera-toolbox/';

function assertUpdateChannel(updater) {
    const expected = new URL(channel + updater.branch + '/manifest.json');
    const actual = updater.buildURL(0, 'manifest.json');
    const legacyHook = Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(updater), '__cemGraphiteUI');
    if (expected.origin !== 'https://raw.githubusercontent.com' ||
        !expected.pathname.startsWith('/Volframid/tera-toolbox/') ||
        actual.href !== expected.href || legacyHook) {
        throw new Error('This installation still uses a legacy Toolbox updater. Repair it with the current Graphite portable release before enabling self-updates.');
    }
    return updater;
}

function createUpdater(branch = 'master') {
    const Updater = require('./update-self');
    return assertUpdateChannel(new Updater(branch));
}

module.exports = { createUpdater, assertUpdateChannel };
