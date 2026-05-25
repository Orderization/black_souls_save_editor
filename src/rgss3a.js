const fs = require('fs');
const path = require('path');

function u32(n) {
  return n >>> 0;
}

function permuteKey(key) {
  return u32(Math.imul(key, 7) + 3);
}

function xorU32(value, key) {
  return u32(value ^ key);
}

function normalizeArchiveName(name) {
  return name.replace(/\\/g, '/');
}

function decryptData(buffer, fileKey) {
  const out = Buffer.allocUnsafe(buffer.length);
  let key = u32(fileKey);
  let keyBytes = Buffer.allocUnsafe(4);
  keyBytes.writeUInt32LE(key, 0);

  for (let i = 0; i < buffer.length; i++) {
    const kpos = i & 3;
    out[i] = buffer[i] ^ keyBytes[kpos];
    if (kpos === 3) {
      key = permuteKey(key);
      keyBytes.writeUInt32LE(key, 0);
    }
  }
  return out;
}

function decryptNameV3(buffer, metadataKey) {
  const keyBytes = Buffer.allocUnsafe(4);
  keyBytes.writeUInt32LE(u32(metadataKey), 0);
  const out = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    out[i] = buffer[i] ^ keyBytes[i & 3];
  }
  return out.toString('utf8');
}

function parseRgss3aArchive(archivePath) {
  const bytes = fs.readFileSync(archivePath);
  if (bytes.length < 16) {
    throw new Error('File is too small to be a valid RGSSAD/RGSS3A archive.');
  }

  const magic = bytes.subarray(0, 6).toString('ascii');
  const version = bytes[7];
  if (magic !== 'RGSSAD' || version !== 3) {
    throw new Error(`Unsupported archive header. Expected RGSSAD v3 (.rgss3a), got magic=${magic}, version=${version}.`);
  }

  let pos = 8;
  const rawMetadataKey = bytes.readUInt32LE(pos); pos += 4;
  const metadataKey = u32(Math.imul(rawMetadataKey, 9) + 3);
  const entries = [];

  while (pos + 16 <= bytes.length) {
    const offset = xorU32(bytes.readUInt32LE(pos), metadataKey); pos += 4;
    const size = xorU32(bytes.readUInt32LE(pos), metadataKey); pos += 4;
    const fileKey = xorU32(bytes.readUInt32LE(pos), metadataKey); pos += 4;
    if (offset === 0) break;
    const nameLength = xorU32(bytes.readUInt32LE(pos), metadataKey); pos += 4;

    if (nameLength < 0 || nameLength > 4096 || pos + nameLength > bytes.length) {
      throw new Error(`Invalid archive metadata near offset 0x${pos.toString(16)}.`);
    }
    const rawName = bytes.subarray(pos, pos + nameLength); pos += nameLength;
    const name = decryptNameV3(rawName, metadataKey);
    const normalizedName = normalizeArchiveName(name);

    if (offset + size > bytes.length) {
      throw new Error(`Archive entry ${name} points outside the archive.`);
    }

    entries.push({ name, normalizedName, offset, size, key: fileKey });
  }

  return { archivePath, version, bytes, entries };
}

function findEntry(archive, archiveName) {
  const normalized = normalizeArchiveName(archiveName).toLowerCase();
  return archive.entries.find(e => e.normalizedName.toLowerCase() === normalized) || null;
}

function extractEntry(archive, entry) {
  const encrypted = archive.bytes.subarray(entry.offset, entry.offset + entry.size);
  return decryptData(encrypted, entry.key);
}

function extractSelectedDataFiles(archive, wantedNames, outDataDir) {
  const extracted = [];
  for (const wanted of wantedNames) {
    const entry = findEntry(archive, wanted);
    if (!entry) continue;
    const data = extractEntry(archive, entry);
    const base = path.basename(entry.normalizedName);
    const outPath = path.join(outDataDir, base);
    fs.writeFileSync(outPath, data);
    extracted.push({ archiveName: entry.normalizedName, path: outPath, size: data.length });
  }
  return extracted;
}

module.exports = {
  parseRgss3aArchive,
  extractSelectedDataFiles,
  extractEntry,
  findEntry
};
