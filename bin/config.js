const path = require('path');
const fs = require('fs');
const ConfigFilePath = path.join(__dirname, '..', 'config.json');

function loadConfig() {
    let result = null;
    try {
        result = fs.readFileSync(ConfigFilePath, 'utf8');
    } catch (_) {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
    }

    return JSON.parse(result);
}

function saveConfig(newConfig) {
    fs.writeFileSync(ConfigFilePath, JSON.stringify(newConfig, null, 4));
}

module.exports = { loadConfig, saveConfig };
