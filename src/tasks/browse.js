'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Toegestane browse-roots: config, anders de home-map, anders /. */
function agentBrowseRoots(config) {
  const roots = (config && config.browseRoots) || [];
  if (roots.length) return roots;
  const home = os.homedir();
  try {
    if (home && fs.statSync(home).isDirectory()) return [home];
  } catch {
    // val door naar /
  }
  return ['/'];
}

/** Veilige containment-check (weerstaat ../ en symlinks in het pad zelf). */
function isWithinAgentRoots(p, roots) {
  const resolved = path.resolve(p);
  return roots.some((r) => {
    const root = path.resolve(r);
    if (resolved === root) return true;
    const rel = path.relative(root, resolved);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

/** Lees de origin-remote (owner/repo) uit .git/config, indien aanwezig. */
function readOriginRemote(repoDir) {
  try {
    const cfg = fs.readFileSync(path.join(repoDir, '.git', 'config'), 'utf8');
    const section = cfg.match(/\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/);
    if (!section) return '';
    const url = section[1].match(/^\s*url\s*=\s*(.+)$/m);
    if (!url) return '';
    const raw = url[1].trim();
    const m = raw.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m ? m[1] : raw.replace(/\.git$/, '');
  } catch {
    return '';
  }
}

async function executeBrowseTask(payload, runtime) {
  const configuredRoots = agentBrowseRoots(runtime.config);
  const baseRoot = payload && payload.base ? path.resolve(String(payload.base)) : configuredRoots[0];
  const roots = payload && payload.base ? [baseRoot] : configuredRoots;
  const requested = payload && payload.path ? String(payload.path) : baseRoot;
  const base = path.resolve(requested.replace(/[\\/]+$/, '') || baseRoot);

  if (!isWithinAgentRoots(base, roots)) {
    return { success: true, path: base, parent: null, entries: [], roots, error: 'Toegang geweigerd: pad buiten toegestane mappen.' };
  }
  if (!fs.existsSync(base)) {
    return { success: true, path: base, parent: path.dirname(base), entries: [], roots, error: 'Path does not exist' };
  }
  if (!fs.statSync(base).isDirectory()) {
    return { success: true, path: base, parent: path.dirname(base), entries: [], roots, error: 'Not a directory' };
  }

  try {
    const all = fs.readdirSync(base, { withFileTypes: true });
    const dirs = [];
    const files = [];
    for (const entry of all) {
      if (entry.name.startsWith('.') && entry.name !== '.git') continue;
      const full = path.join(base, entry.name);
      try {
        const s = fs.statSync(full);
        if (s.isDirectory()) {
          const hasGit = fs.existsSync(path.join(full, '.git'));
          const dirEntry = { name: entry.name, type: 'dir', path: full, hasGit };
          if (hasGit) dirEntry.remote = readOriginRemote(full);
          dirs.push(dirEntry);
        } else {
          files.push({ name: entry.name, type: 'file', path: full });
        }
      } catch {
        // overslaan
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    const parent = base === path.parse(base).root ? null : path.dirname(base);
    const parentOk = parent && isWithinAgentRoots(parent, roots) ? parent : null;
    return { success: true, path: base, parent: parentOk, entries: [...dirs, ...files], roots };
  } catch {
    return { success: true, path: base, parent: null, entries: [], roots, error: 'Kon map niet lezen.' };
  }
}

module.exports = { executeBrowseTask, agentBrowseRoots, isWithinAgentRoots };
