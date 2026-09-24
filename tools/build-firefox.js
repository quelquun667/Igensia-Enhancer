#!/usr/bin/env node
// Génère la version Firefox de l'extension.
//
// Le manifest du dépôt (IgensiaExtension/manifest.json) est écrit pour Chrome/Edge :
// Firefox n'accepte pas `background.service_worker` en MV3 et demande un identifiant
// d'extension. Ajouter ces clés au manifest principal afficherait des avertissements
// dans chrome://extensions, d'où ce script.
//
// Usage : node tools/build-firefox.js
// Résultat : dist/IgensiaExtension-firefox/ (à charger dans about:debugging)
//            dist/IgensiaExtension-firefox.zip (à joindre aux releases GitHub)
// Aucune dépendance : Node 18+ suffit.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'IgensiaExtension');
const DIST = path.join(ROOT, 'dist');
const OUT_NAME = 'IgensiaExtension-firefox';
const OUT_DIR = path.join(DIST, OUT_NAME);
const OUT_ZIP = path.join(DIST, `${OUT_NAME}.zip`);

const GECKO = {
    id: 'igensia-enhancer@quelquun667',
    // storage.session (suivi du temps passé) est disponible à partir de Firefox 115
    strict_min_version: '115.0'
};

function firefoxManifest(manifest) {
    const out = { ...manifest };
    const worker = manifest.background && manifest.background.service_worker;
    out.background = { scripts: [worker || 'background.js'] };
    out.browser_specific_settings = { gecko: GECKO };
    return out;
}

// ---------- ZIP minimal (deflate), pour ne dépendre d'aucun outil externe ----------
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function writeZip(files, zipPath) {
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const { name, data } of files) {
        const nameBuf = Buffer.from(name, 'utf8');
        const compressed = zlib.deflateRawSync(data, { level: 9 });
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);        // version needed
        local.writeUInt16LE(0x0800, 6);    // UTF-8 names
        local.writeUInt16LE(8, 8);         // deflate
        local.writeUInt32LE(0, 10);        // time/date
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        chunks.push(local, nameBuf, compressed);

        const entry = Buffer.alloc(46);
        entry.writeUInt32LE(0x02014b50, 0);
        entry.writeUInt16LE(20, 4);
        entry.writeUInt16LE(20, 6);
        entry.writeUInt16LE(0x0800, 8);
        entry.writeUInt16LE(8, 10);
        entry.writeUInt32LE(0, 12);
        entry.writeUInt32LE(crc, 16);
        entry.writeUInt32LE(compressed.length, 20);
        entry.writeUInt32LE(data.length, 24);
        entry.writeUInt16LE(nameBuf.length, 28);
        entry.writeUInt32LE(offset, 42);
        central.push(entry, nameBuf);

        offset += local.length + nameBuf.length + compressed.length;
    }
    const centralBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, end]));
}

// ---------- Build ----------
function listFiles(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
    });
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const files = listFiles(SRC).map(rel => {
    let data = fs.readFileSync(path.join(SRC, rel));
    if (rel === 'manifest.json') {
        data = Buffer.from(JSON.stringify(firefoxManifest(JSON.parse(data.toString('utf8'))), null, 2) + '\n');
    }
    const target = path.join(OUT_DIR, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    // Firefox attend manifest.json à la racine de l'archive
    return { name: rel.split(path.sep).join('/'), data };
});

writeZip(files, OUT_ZIP);

const version = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8')).version;
console.log(`Version Firefox ${version} générée :`);
console.log(`  ${path.relative(ROOT, OUT_DIR)}${path.sep}`);
console.log(`  ${path.relative(ROOT, OUT_ZIP)} (${files.length} fichiers)`);
