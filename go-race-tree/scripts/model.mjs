const warning = /^\s*WARNING: DATA RACE\s*$/i;
const separator = /^\s*={8,}\s*$/;
const accessHeader = /^\s*(Previous\s+)?(Atomic\s+)?(Read|Write)(?:\s+at\s+(0x[\da-f]+))?\s+by\s+(?:goroutine\s+(\d+)|(main goroutine)):\s*$/i;
const creationHeader = /^\s*Goroutine\s+(\d+)(?:\s+\(([^)]*)\))?\s+created at:\s*$/i;
const locationLine = /^\s+(.+?):(\d+)(?:\s+\+(0x[\da-f]+))?\s*$/i;

function reportBlocks(text) {
  const blocks = [];
  let block = [];
  for (const [index, textLine] of text.split(/\r\n?|\n/).entries()) {
    if (separator.test(textLine) || warning.test(textLine)) {
      if (block.length) blocks.push(block);
      block = [];
    }
    if (!separator.test(textLine)) block.push({ number: index + 1, text: textLine });
  }
  if (block.length) blocks.push(block);
  return blocks.filter(lines => lines.some(line => warning.test(line.text) || accessHeader.test(line.text)));
}

function parseStack(lines) {
  const frames = [];
  const notes = [];
  let symbol;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const location = locationLine.exec(line.text);
    if (location) {
      const [, file, number, offset] = location;
      frames.push({
        symbol: symbol?.text.trim() ?? '',
        file,
        line: Number(number),
        ...(offset ? { offset } : {}),
        rawLine: symbol?.number ?? line.number,
      });
      symbol = undefined;
    } else if (/^\s+\S.*\)\s*$/.test(line.text)) {
      if (symbol) frames.push({ symbol: symbol.text.trim(), rawLine: symbol.number });
      symbol = line;
    } else {
      if (symbol) frames.push({ symbol: symbol.text.trim(), rawLine: symbol.number });
      symbol = undefined;
      notes.push(line.text.trim());
    }
  }
  if (symbol) frames.push({ symbol: symbol.text.trim(), rawLine: symbol.number });
  return { frames, notes };
}

function parseBlock(lines, index) {
  const sections = [];
  let section;
  for (const line of lines) {
    const access = accessHeader.exec(line.text);
    const creation = creationHeader.exec(line.text);
    if (access || creation) {
      section = { access, creation, rawLine: line.number, stack: [] };
      sections.push(section);
    } else if (section && (line.text.trim() === '' || /^\s/.test(line.text) ||
      /^failed to restore the stack/i.test(line.text))) {
      section.stack.push(line);
    } else {
      section = undefined;
    }
  }

  const goroutines = new Map();
  const accesses = [];
  const warnings = [];
  for (const { access, creation, stack, rawLine } of sections) {
    if (creation) {
      const [, id, state] = creation;
      const previous = goroutines.get(id);
      const creationStack = { ...parseStack(stack), rawLine };
      if (previous?.creation) {
        warnings.push(`G ${id} 有多段创建栈，详情显示第一段，原文保留全部。`);
      } else {
        goroutines.set(id, { id, state, creation: creationStack });
      }
    } else {
      const [, previous, atomic, kind, address, number, main] = access;
      const id = main ? 'main' : number;
      if (!goroutines.has(id)) goroutines.set(id, { id });
      if (accesses.length < 2) {
        accesses.push({
          goroutine: id, kind: kind.toLowerCase(), previous: Boolean(previous), atomic: Boolean(atomic),
          address, rawLine, stack: parseStack(stack),
        });
      } else {
        warnings.push(`第 ${rawLine} 行含额外访问段，原文保留该段。`);
      }
    }
  }
  return {
    id: index + 1,
    goroutines: [...goroutines.values()],
    accesses,
    raw: lines.map(line => line.text).join('\n').trimEnd(),
    rawStartLine: lines[0].number,
    warnings,
  };
}

export function parseGoReport(text) {
  const reports = reportBlocks(text.replace(/^\uFEFF/, '')).map(parseBlock);
  if (!reports.some(report => report.accesses.length)) {
    throw new Error('未识别到 Go -race 访问段。请提供原始报告或使用 --data 传入已整理的报告。');
  }
  return reports;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

const hasText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;

function validateLocation(value) {
  return isRecord(value) && hasText(value.file) && positiveInteger(value.line);
}

function validateStack(stack, name) {
  requireValue(isRecord(stack) && Array.isArray(stack.frames), `${name} 缺少 frames 数组。`);
  requireValue(stack.notes === undefined ||
    (Array.isArray(stack.notes) && stack.notes.every(hasText)), `${name} 的 notes 必须是文本数组。`);
  for (const frame of stack.frames) {
    requireValue(isRecord(frame) && (hasText(frame.symbol) || validateLocation(frame)),
      `${name} 有无法识别的栈帧。`);
    requireValue(frame.file === undefined || validateLocation(frame), `${name} 有无效的文件位置。`);
  }
}

function validateReport(report) {
  requireValue(isRecord(report) && positiveInteger(report.id) && Array.isArray(report.accesses) &&
    report.accesses.length <= 2 && Array.isArray(report.goroutines), '报告必须有有效 id、accesses 和 goroutines。');
  const known = new Set();
  for (const node of report.goroutines) {
    requireValue(isRecord(node) && hasText(node.id) && !known.has(node.id), `报告 ${report.id} 的 goroutine ID 无效或重复。`);
    requireValue(node.context === undefined || typeof node.context === 'boolean', 'context 必须为布尔值。');
    if (node.creation !== undefined) validateStack(node.creation, `G ${node.id} 的创建栈`);
    known.add(node.id);
  }
  const sourceContexts = new Set(report.goroutines.filter(node => node.context).map(node => node.id));
  for (const access of report.accesses) {
    requireValue(isRecord(access) && known.has(access.goroutine) && !sourceContexts.has(access.goroutine) &&
      ['read', 'write'].includes(access.kind), `报告 ${report.id} 的访问类型或 goroutine ID 无效。`);
    validateStack(access.stack, '访问栈');
  }
  requireValue(report.warnings === undefined ||
    (Array.isArray(report.warnings) && report.warnings.every(hasText)), 'warnings 必须是文本数组。');
}

export function normalizedReports(input) {
  requireValue(isRecord(input) && Array.isArray(input.reports) && input.reports.length,
    '--data 需要包含 reports 数组的 JSON 对象。');
  const ids = new Set();
  for (const report of input.reports) {
    validateReport(report);
    requireValue(!ids.has(report.id), `报告 ID ${report.id} 重复。`);
    ids.add(report.id);
  }
  requireValue(input.reports.some(report => report.accesses.length), '数据中至少需要一处访问。');
  return input.reports;
}

// Parent maps contain one edge per child. Drop entire invalid cycles before traversing ancestors.
function cycleChildren(parents) {
  const visited = new Set();
  const cyclic = new Set();
  for (const start of parents.keys()) {
    const path = new Map();
    let id = start;
    while (parents.has(id) && !visited.has(id) && !path.has(id)) {
      path.set(id, path.size);
      id = parents.get(id).parent;
    }
    if (path.has(id)) {
      const cycleStart = path.get(id);
      for (const [child, depth] of path) if (depth >= cycleStart) cyclic.add(child);
    }
    for (const child of path.keys()) visited.add(child);
  }
  return cyclic;
}

function walk(from, parents) {
  const path = [from];
  while (parents.has(from)) {
    from = parents.get(from).parent;
    path.push(from);
  }
  return path;
}

function describePair(accesses, parents) {
  if (accesses.length < 2) return { kind: 'partial' };
  const [a, b] = accesses.map(access => access.goroutine);
  if (a === b) return { kind: 'same' };
  const pathA = walk(a, parents);
  const pathB = walk(b, parents);
  const pathBNodes = new Set(pathB);
  const ancestor = pathA.find(id => pathBNodes.has(id));
  if (ancestor === undefined) return { kind: 'unknown' };
  const branches = [pathA, pathB].map(path => path.slice(0, path.indexOf(ancestor)));
  const children = branches.flat();
  const status = children.some(id => parents.get(id).status === 'inferred') ? 'inferred' : 'confirmed';
  const directLine = ancestor === a || ancestor === b;
  const kind = directLine ? (children.length === 1 ? 'parent' : 'ancestor') : 'lca';
  return { kind, ancestor, status, children };
}

function derive(report, extra = {}) {
  const nodes = new Map(report.goroutines.map(node => [node.id, node]));
  const warnings = [...(report.warnings ?? []), ...(extra.warnings ?? [])];
  const candidates = new Map();
  for (const node of extra.goroutines ?? []) {
    requireValue(isRecord(node) && hasText(node.id) && !nodes.has(node.id), `报告 ${report.id} 的补充 goroutine ID 无效或重复。`);
    requireValue(node.context === undefined || typeof node.context === 'boolean', 'context 必须为布尔值。');
    if (node.creation !== undefined) validateStack(node.creation, `G ${node.id} 的创建栈`);
    nodes.set(node.id, node);
  }
  for (const edge of extra.edges ?? []) {
    requireValue(isRecord(edge) && nodes.has(edge.parent) && nodes.has(edge.child) &&
      ['confirmed', 'inferred'].includes(edge.status) && hasText(edge.evidence),
    `报告 ${report.id} 的派生证据需要已声明的端点、有效状态和出处。`);
    requireValue(edge.status !== 'inferred' || validateLocation(edge.site), '源码推断必须提供创建位置 file 和 line。');
    requireValue(edge.site === undefined || validateLocation(edge.site), '创建位置需要 file 和 line。');
    requireValue(edge.status !== 'confirmed' || (!nodes.get(edge.parent).context && !nodes.get(edge.child).context),
      '源码上下文不能作为已确认派生边的端点。');
    const incoming = candidates.get(edge.child) ?? [];
    incoming.push({ ...edge, disposition: 'candidate' });
    candidates.set(edge.child, incoming);
  }

  const parents = new Map();
  const inferred = [];
  for (const [child, incoming] of candidates) {
    const eligible = incoming.some(edge => edge.status === 'confirmed')
      ? incoming.filter(edge => edge.status === 'confirmed')
      : incoming;
    const distinct = new Set(eligible.map(edge => edge.parent));
    if (distinct.size > 1) {
      warnings.push(`${child} 有多个父候选，详情保留各项证据。`);
      continue;
    }
    const edge = eligible[0];
    const selection = { ...edge, evidence: [...new Set(eligible.map(item => item.evidence))].join('\n') };
    if (edge.status === 'confirmed') parents.set(child, selection);
    else inferred.push(selection);
  }
  for (const child of cycleChildren(parents)) {
    parents.delete(child);
    warnings.push(`${child} 的已确认父级证据形成环，已忽略该边。`);
  }
  for (const edge of inferred) parents.set(edge.child, edge);
  for (const child of cycleChildren(parents)) {
    if (parents.get(child).status === 'inferred') {
      parents.delete(child);
      warnings.push(`${child} 的源码候选会形成环，已忽略该边。`);
    }
  }
  for (const [child, incoming] of candidates) {
    const selected = parents.get(child);
    for (const edge of incoming) {
      if (selected?.parent === edge.parent && selected.status === edge.status) edge.disposition = 'selected';
    }
  }

  const visible = new Set(report.accesses.flatMap(access => walk(access.goroutine, parents)));
  const relation = describePair(report.accesses, parents);
  const branches = [...visible].map(id => ({
    ...nodes.get(id),
    ...(parents.has(id) ? { edge: parents.get(id) } : {}),
    candidates: candidates.get(id) ?? [],
  }));
  if (!report.accesses.length) warnings.push('此条报告没有可展示的访问。');
  if (report.accesses.length === 1) warnings.push('仅识别到一处访问，冲突的另一端缺失。');
  return { ...report, warnings, branches, relation, goroutines: [...nodes.values()] };
}

export function buildView(reports, evidence = { reports: [] }) {
  requireValue(isRecord(evidence) && Array.isArray(evidence.reports), '补充证据需要 reports 数组。');
  const reportIds = new Set(reports.map(report => report.id));
  const extras = new Map();
  for (const extra of evidence.reports) {
    requireValue(isRecord(extra) && reportIds.has(extra.id) && !extras.has(extra.id),
      '补充证据的报告 id 不存在或重复。');
    requireValue(extra.goroutines === undefined || Array.isArray(extra.goroutines), 'goroutines 必须是数组。');
    requireValue(extra.edges === undefined || Array.isArray(extra.edges), 'edges 必须是数组。');
    requireValue(extra.warnings === undefined ||
      (Array.isArray(extra.warnings) && extra.warnings.every(hasText)), 'warnings 必须是文本数组。');
    extras.set(extra.id, extra);
  }
  return reports.map(report => derive(report, extras.get(report.id)));
}
