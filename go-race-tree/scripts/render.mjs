#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { stdin } from 'node:process';
import { parseArgs } from 'node:util';
import { buildView, normalizedReports, parseGoReport } from './model.mjs';

const usage = `用法（Node.js 20+）
  node scripts/render.mjs --report race.log --output race-tree.html [--evidence evidence.json]
  node scripts/render.mjs --report - --output race-tree.html
  node scripts/render.mjs --data reports.json --output race-tree.html [--evidence evidence.json]

--report - 从标准输入读取 UTF-8 文本。日志文件也支持带 BOM 的 UTF-16。
--output 指定新 HTML 文件。证据和结构化数据格式见 references/report-input.md。`;

async function readText(path) {
  let bytes;
  if (path === '-') {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    bytes = Buffer.concat(chunks);
  } else {
    bytes = await readFile(path);
  }
  const littleEndian = bytes[0] === 0xff && bytes[1] === 0xfe;
  const bigEndian = bytes[0] === 0xfe && bytes[1] === 0xff;
  const encoding = littleEndian ? 'utf-16le' : bigEndian ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

async function main() {
  const { values } = parseArgs({
    options: {
      report: { type: 'string' },
      data: { type: 'string' },
      evidence: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (Boolean(values.report) === Boolean(values.data) || !values.output) {
    throw new Error('请指定 --report 或 --data，并提供 --output。\n' + usage);
  }
  if ([values.data, values.evidence].includes('-')) {
    throw new Error('标准输入仅用于 --report -。');
  }

  const [input, evidence, template] = await Promise.all([
    readText(values.report ?? values.data),
    values.evidence ? readText(values.evidence).then(JSON.parse) : undefined,
    readFile(new URL('../assets/report.html', import.meta.url), 'utf8'),
  ]);
  const reports = values.report ? parseGoReport(input) : normalizedReports(JSON.parse(input));
  const view = buildView(reports, evidence);
  // Escape '<' so report text cannot end the inert JSON script element.
  const payload = JSON.stringify(view).replaceAll('<', '\\u003c');
  const html = template.replace('<!--REPORT_DATA-->', () => payload);
  await writeFile(values.output, html, { encoding: 'utf8', flag: 'wx' });
  console.log(`已生成 ${values.output}（${view.length} 条报告）`);
}

main().catch(error => {
  console.error(error.code === 'EEXIST' ? '输出文件已存在，请使用新的 --output 路径。' : error.message);
  process.exitCode = 1;
});
