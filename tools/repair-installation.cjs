'use strict';

// Replace only checksum-verified public core files; user configuration/modules
// never belong to this list. Keep an explicit rollback copy before writing.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();

function repairInstallation({ source = path.resolve(__dirname, '..'), target, backup }) {
    source = fs.realpathSync(source);
    target = fs.realpathSync(target);
    backup = path.resolve(backup);
    if (source === target || backup === target || backup.startsWith(target + path.sep) ||
        backup === source || backup.startsWith(source + path.sep)) {
        throw new Error('Use separate source, installation and backup directories.');
    }
    if (fs.existsSync(backup) && fs.readdirSync(backup).length) throw new Error('Backup directory must be empty.');
    const manifestBytes = fs.readFileSync(path.join(source, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    const payloads = [];
    for (const [name, expected] of Object.entries(manifest.files)) {
        if (name.includes('\\') || path.posix.isAbsolute(name) || path.win32.isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..') ||
            /(?:^mods\/|^config\.json$|LOCAL_UPDATES|module\.config|user-assets|ui-backups|(?:^|\/)logs\/|profiles\/|\.jsonl$|\.log$)/i.test(name)) {
            throw new Error('Private or unsafe path in core manifest: ' + name);
        }
        const bytes = fs.readFileSync(path.join(source, name));
        if (typeof expected !== 'string' || hash(bytes) !== expected.toUpperCase()) throw new Error('Source checksum mismatch: ' + name);
        payloads.push({ name, bytes });
    }
    payloads.push({ name: 'manifest.json', bytes: manifestBytes });
    const changed = payloads.filter(p => !fs.existsSync(path.join(target, p.name)) ||
        !fs.readFileSync(path.join(target, p.name)).equals(p.bytes));
    // Preflight every destination before making any change.
    for (const p of changed) if (fs.existsSync(path.join(target, p.name))) {
        const handle = fs.openSync(path.join(target, p.name), 'r+');
        fs.closeSync(handle);
    }
    fs.mkdirSync(backup, { recursive: true });
    for (const p of changed) {
        p.existed = fs.existsSync(path.join(target, p.name));
        if (p.existed) {
            const saved = path.join(backup, p.name);
            fs.mkdirSync(path.dirname(saved), { recursive: true });
            fs.copyFileSync(path.join(target, p.name), saved);
        }
    }
    fs.writeFileSync(path.join(backup, 'repair.json'), JSON.stringify({ source, target,
        files: changed.map(p => ({ name: p.name, existed: p.existed })) }, null, 2) + '\n');
    const written = [];
    try {
        for (const p of changed) {
            const destination = path.join(target, p.name);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            written.push(p);
            fs.writeFileSync(destination, p.bytes);
            if (hash(fs.readFileSync(destination)) !== hash(p.bytes)) throw new Error('Installed checksum mismatch: ' + p.name);
        }
    } catch (error) {
        for (const p of written.reverse()) {
            if (p.existed) fs.copyFileSync(path.join(backup, p.name), path.join(target, p.name));
            else if (fs.existsSync(path.join(target, p.name))) fs.unlinkSync(path.join(target, p.name));
        }
        throw error;
    }
    return { repaired: changed.map(p => p.name), publicFilesVerified: payloads.length, backup };
}

module.exports = { repairInstallation };
if (require.main === module) {
    const args = process.argv.slice(2), target = args.indexOf('--target'), backup = args.indexOf('--backup');
    if (target < 0 || backup < 0 || !args[target + 1] || !args[backup + 1]) {
        console.error('Usage: node tools/repair-installation.cjs --target <existing Toolbox folder> --backup <empty separate folder>');
        process.exitCode = 1;
    } else {
        try { console.log(JSON.stringify(repairInstallation({ target: args[target + 1], backup: args[backup + 1] }))); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
