// Post-compile step for scripts compiled with tsc into /tmp/amg-bt-build:
// tsc does not rewrite the "@/..." path alias, so rewrite
// require("@/lib/...") to the correct relative require in the emitted JS.
// Usage: node scripts/resolve-aliases.mjs [outDir]
// Default outDir: /tmp/amg-bt-build
import * as fs from 'fs';
import * as path from 'path';

const outDir = path.resolve(process.argv[2] || '/tmp/amg-bt-build');
const srcRoot = path.join(outDir, 'src');

function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(p));
        else if (e.isFile() && p.endsWith('.js')) out.push(p);
    }
    return out;
}

let rewritten = 0;
for (const file of walk(outDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('"@/')) continue;
    const next = text.replace(/require\("@\/([^"]+)"\)/g, (_m, aliasPath) => {
        const target = path.join(srcRoot, aliasPath);
        let rel = path.relative(path.dirname(file), target);
        if (!rel.startsWith('.')) rel = './' + rel;
        return `require("${rel}")`;
    });
    if (next !== text) {
        fs.writeFileSync(file, next);
        rewritten++;
    }
}
console.log(`resolve-aliases: rewrote @/ requires in ${rewritten} file(s) under ${outDir}`);
