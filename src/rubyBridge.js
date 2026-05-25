const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

class RubyRvdata2Bridge {
  constructor(helperPath) {
    this.helperPath = helperPath;
  }

  run(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('ruby', [this.helperPath, ...args], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', err => {
        if (err.code === 'ENOENT') {
          reject(new Error('Ruby is not installed or not in PATH. On CachyOS: sudo pacman -S ruby'));
        } else {
          reject(err);
        }
      });
      child.on('close', code => {
        let payload;
        try {
          const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
          payload = JSON.parse(lines[lines.length - 1] || '{}');
        } catch (e) {
          reject(new Error(`Ruby helper returned invalid JSON.\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`));
          return;
        }
        if (code !== 0 || !payload.ok) {
          reject(new Error(payload.error || stderr || `Ruby helper failed with exit code ${code}.`));
          return;
        }
        resolve(payload);
      });
    });
  }

  database(dbDir) {
    return this.run(['database', dbDir || '']);
  }

  summary(savePath, dbDir) {
    return this.run(['summary', savePath, dbDir || '']);
  }

  apply(savePath, patch) {
    const patchPath = path.join(os.tmpdir(), `bs-vxace-patch-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(patchPath, JSON.stringify(patch, null, 2), 'utf8');
    return this.run(['apply', savePath, patchPath]).finally(() => {
      try { fs.unlinkSync(patchPath); } catch (_) {}
    });
  }
}

module.exports = { RubyRvdata2Bridge };
