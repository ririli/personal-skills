const text = value => typeof value === 'string' && value.trim().length > 0;
const location = value => value && text(value.file) && Number.isSafeInteger(value.line) && value.line > 0;
const fileKey = file => file.replaceAll('\\', '/');

function check(condition, message) {
  if (!condition) throw new Error('callPaths：' + message);
}

function validatePath(path, report, known) {
  check(path && Number.isInteger(path.access) && report.accesses[path.access], 'access 必须对应本报告的访问索引。');
  check(Array.isArray(path.nodes) && path.nodes.length > 0 && Array.isArray(path.edges) &&
    path.edges.length === path.nodes.length - 1, '需要非空 nodes 和相邻节点之间的 edges。');
  for (const node of path.nodes) {
    check(node && text(node.symbol), '函数节点需要 symbol。');
    check(node.definition === undefined || location(node.definition), 'definition 需要 file 和正整数 line。');
    check(node.file === undefined || location(node), '节点位置需要 file 和正整数 line。');
    check(node.goroutine === undefined || known.has(node.goroutine), 'goroutine 必须是本报告已声明的 ID。');
  }
  check(path.nodes.at(-1).goroutine === report.accesses[path.access].goroutine,
    '末节点的 goroutine 必须与竞争访问一致。');
  for (let i = 0; i < path.edges.length; i++) {
    const edge = path.edges[i];
    check(edge && ['call', 'go'].includes(edge.kind) && ['confirmed', 'inferred'].includes(edge.status) &&
      ['report', 'source'].includes(edge.source) && text(edge.evidence), '边需要 kind、status、source 和 evidence。');
    check(edge.site === undefined || location(edge.site), '边的位置需要 file 和正整数 line。');
    check(edge.source !== 'source' || location(edge.site), '源码边必须提供调用点 site。');
    const caller = path.nodes[i].goroutine;
    const callee = path.nodes[i + 1].goroutine;
    check(edge.kind !== 'call' || caller === undefined || callee === undefined || caller === callee,
      '普通调用的两端必须属于同一 goroutine。');
    check(edge.kind !== 'go' || caller === undefined || callee === undefined || caller !== callee,
      'go 创建的两端应属于不同 goroutine。');
  }
}

export function buildCallGraph(report, suppliedPaths) {
  const known = new Set(report.goroutines.map(node => node.id));
  const paths = suppliedPaths ?? [];
  check(Array.isArray(paths), '必须是数组。');
  paths.forEach(path => validatePath(path, report, known));
  const nodes = new Map();
  const edges = [];
  const gaps = [];

  function addChain(frames, access, scope, owner, metadata) {
    const chain = frames.map((frame, index) => {
      const identity = frame.definition
        ? 'definition:' + JSON.stringify([fileKey(frame.definition.file), frame.definition.line, frame.symbol])
        : scope + ':' + JSON.stringify([frame.symbol || '', frame.file ? fileKey(frame.file) : '', frame.symbol ? '' : index]);
      let node = nodes.get(identity);
      if (!node) {
        node = { id: identity, symbol: frame.symbol || '函数未知', definition: frame.definition,
          frames: [], accesses: [], terminals: [], goroutines: [], contexts: [] };
        nodes.set(identity, node);
      }
      node.accesses = [...new Set([...node.accesses, access])];
      const goroutine = frame.goroutine ?? owner;
      if (goroutine !== undefined) node.goroutines = [...new Set([...node.goroutines, goroutine])];
      else node.contexts = [...new Set([...node.contexts, '创建者实例未知'])];
      node.frames.push({ ...frame, access, goroutine });
      return identity;
    });
    for (let i = 0; i < chain.length - 1; i++) {
      edges.push({ from: chain[i], to: chain[i + 1], access, ...metadata[i] });
    }
    return chain;
  }

  report.accesses.forEach((access, index) => {
    const explicit = paths.filter(path => path.access === index);
    if (explicit.length) {
      for (const [number, path] of explicit.entries()) {
        const ids = addChain(path.nodes, index, 'path:' + index + ':' + number, undefined, path.edges);
        nodes.get(ids.at(-1)).terminals.push(index);
      }
      return;
    }
    const frames = [...access.stack.frames].reverse();
    const stackEdges = frames.slice(0, -1).map(frame => ({
      kind: 'call', status: 'confirmed', source: 'report',
      evidence: '访问栈相邻帧' + (frame.rawLine ? '，日志第 ' + frame.rawLine + ' 行' : ''),
      site: frame.file ? { file: frame.file, line: frame.line } : undefined,
    }));
    const ids = addChain(frames, index, 'access:' + index, access.goroutine, stackEdges);
    if (ids.length) nodes.get(ids.at(-1)).terminals.push(index);
    else gaps.push({ access: index, message: '访问栈缺失，无法还原函数调用路径。' });

    const visited = new Set();
    let child = access.goroutine;
    while (!visited.has(child)) {
      visited.add(child);
      const node = report.branches.find(item => item.id === child);
      const creation = [...(node?.creation?.frames ?? [])].reverse();
      if (creation.length) {
        addChain(creation, index, 'creation:' + child, node?.edge?.parent,
          creation.slice(0, -1).map(frame => ({
            kind: 'call', status: 'confirmed', source: 'report',
            evidence: 'G ' + child + ' 的创建栈相邻帧' + (frame.rawLine ? '，日志第 ' + frame.rawLine + ' 行' : ''),
            site: frame.file ? { file: frame.file, line: frame.line } : undefined,
          })));
        gaps.push({ access: index, message: 'G ' + child + ' 的创建点与子入口尚未核对，创建栈单独展示。' });
      } else if (child !== 'main') {
        gaps.push({ access: index, message: 'G ' + child + ' 缺少创建栈，向上溯源止于已有证据。' });
      }
      if (!node?.edge) break;
      child = node.edge.parent;
    }
  });
  return { nodes: [...nodes.values()], edges, gaps };
}
