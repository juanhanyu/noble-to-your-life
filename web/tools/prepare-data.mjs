// 独立部署用：把小程序分包数据复制到 web/data/，让 web/ 目录可以单独上传。
// 用法：node web/tools/prepare-data.mjs
// 生成的文件与仓库中已有的数据完全一致，不会被提交（见 .gitignore）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const repo = path.resolve(web, '..');
const source = path.join(repo, 'miniprogram', 'library');
const target = path.join(web, 'data');

const manifest = JSON.parse(fs.readFileSync(path.join(web, 'manifest.json'), 'utf8'));
fs.mkdirSync(target, { recursive: true });

let total = 0;
for (const edition of manifest) {
  for (let part = 0; part < edition.parts; part++) {
    const from = path.join(source, `${edition.id}${part}`, 'data.js');
    const to = path.join(target, `${edition.id}${part}.js`);
    fs.copyFileSync(from, to);
    total += fs.statSync(to).size;
  }
}

for (const file of ['manifest.json', 'normalize.json']) {
  fs.copyFileSync(path.join(repo, 'miniprogram', file), path.join(web, file));
}

console.log(`已复制 ${manifest.length * 3} 个数据文件到 web/data/，共 ${(total / 1024 / 1024).toFixed(1)} MB。`);
console.log('现在可以把 web/ 整个目录上传到任意静态空间。');
