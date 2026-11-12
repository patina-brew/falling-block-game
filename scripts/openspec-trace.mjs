#!/usr/bin/env node
// OpenSpec のIDと対応関係を検査し、台帳を生成する。
// 仕様: テンプレートの docs/openspec-trace-spec.md
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OS = path.join(ROOT, 'openspec');

const RE = {
  req: /^### Requirement: (N?REQ-\d{3}) - .+$/,
  reqLoose: /^### Requirement:/,
  scn: /^#### Scenario: ((N?REQ-\d{3})-S\d{2}) - .+$/,
  scnLoose: /^#### Scenario:/,
  decision: /^### (D-\d{2}) - .+$/,
  idInText: /(?<![A-Z0-9-])(N?REQ-\d{3}-S\d{2})(?![0-9])/g,
  reqId: /N?REQ-\d{3}/,
};

// ---------- 読み取り ----------

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const dirs = (p) =>
  fs.existsSync(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];

// spec.md を解析する。正式仕様は section = "Requirements"、差分は ADDED などになる。
function parseSpec(text, file) {
  const result = { purpose: '', requirements: [], formatErrors: [] };
  let section = null;
  let current = null;
  let inPurpose = false;
  let inCode = false;
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) inCode = !inCode;
    if (inCode) return;
    const h2 = line.match(/^## (.+?)\s*$/);
    if (h2) {
      inPurpose = h2[1] === 'Purpose';
      const m = h2[1].match(/^(ADDED|MODIFIED|REMOVED|RENAMED) Requirements$/);
      section = m ? m[1] : h2[1] === 'Requirements' ? 'MAIN' : null;
      current = null;
      return;
    }
    if (inPurpose && !line.startsWith('#')) result.purpose += line.trim();
    if (section === 'RENAMED') {
      const m = line.match(/^\s*-\s*(FROM|TO):.*?(N?REQ-\d{3})/);
      if (m && m[1] === 'TO') result.requirements.push({ id: m[2], name: '', op: 'RENAMED', scenarios: [] });
      return;
    }
    if (RE.reqLoose.test(line)) {
      const m = line.match(RE.req);
      if (!m) {
        result.formatErrors.push(`${file}:${i + 1}: 要件の見出しが書式に合わない: ${line}`);
        current = null;
        return;
      }
      current = { id: m[1], name: line.replace(/^### Requirement: N?REQ-\d{3} - /, ''), op: section, scenarios: [] };
      result.requirements.push(current);
      return;
    }
    if (RE.scnLoose.test(line)) {
      const m = line.match(RE.scn);
      if (!m) {
        result.formatErrors.push(`${file}:${i + 1}: シナリオの見出しが書式に合わない: ${line}`);
        return;
      }
      if (!current) return;
      if (m[2] !== current.id) result.formatErrors.push(`${file}:${i + 1}: シナリオID ${m[1]} が親の要件ID ${current.id} と一致しない`);
      current.scenarios.push(m[1]);
    }
  });
  return result;
}

function loadSpecsDir(base) {
  const caps = {};
  for (const cap of dirs(base)) {
    const file = path.join(base, cap, 'spec.md');
    const text = read(file);
    if (text !== null) caps[cap] = parseSpec(text, path.relative(ROOT, file));
  }
  return caps;
}

function section(text, heading) {
  if (!text) return '';
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

function tableRows(text) {
  return text
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)))
    .slice(1); // 見出し行を除く
}

function loadChange(dir) {
  const design = read(path.join(dir, 'design.md'));
  const tasks = read(path.join(dir, 'tasks.md'));
  const proposal = read(path.join(dir, 'proposal.md'));
  const decisions = {};
  if (design) {
    let cur = null;
    for (const line of design.split('\n')) {
      const m = line.match(RE.decision);
      if (m) {
        cur = m[1];
        decisions[cur] = { promotion: 'なし' };
        continue;
      }
      if (/^#{1,3} /.test(line)) cur = null;
      const p = line.match(/^- 昇格:\s*(.+)$/);
      if (cur && p) decisions[cur].promotion = p[1].trim().replace(/\\$/, '').replace(/。$/, '').trim();
    }
  }
  const plan = tableRows(section(design, '検証計画')).map(([id, decision, method]) => ({ id, decision, method }));
  const taskLines = (tasks || '').split('\n').filter((l) => /^\s*-\s*\[[^\]]*\]/.test(l));
  return {
    name: path.basename(dir),
    specs: loadSpecsDir(path.join(dir, 'specs')),
    design,
    decisions,
    plan,
    tasks: tasks || '',
    incompleteTasks: taskLines.filter((l) => !/^\s*-\s*\[\s*[xX]\s*\]/.test(l)),
    stops: section(proposal, '未決事項').split('\n').filter((l) => /^\s*-\s*停止:/.test(l)),
  };
}

function loadManualChecks() {
  const text = read(path.join(OS, 'manual-checks.md')) || '';
  return tableRows(text).map((c) => ({ id: c[0], status: c[3] || '' }));
}

function loadReadmeCaps() {
  const text = read(path.join(OS, 'specs', 'README.md'));
  if (text === null) return null;
  return tableRows(section(text, '一覧'))
    .map((c) => c[0].replace(/^\[([^\]]+)\].*$/, '$1').replace(/`/g, '').trim())
    .filter(Boolean);
}

// ---------- テストファイル ----------

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'openspec', '.venv', 'venv', '__pycache__', 'dist', 'build']);
const DEFAULT_TEST = /^(test_.*|.*_test\..+|.*\.test\..+|.*\.spec\..+)$/;

function listFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      listFiles(path.join(dir, e.name), acc);
    } else acc.push(path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
  }
  return acc;
}

function loadTests() {
  const conf = read(path.join(OS, 'trace.json'));
  const globs = conf ? JSON.parse(conf).testGlobs || [] : null;
  const files = listFiles(ROOT).filter((f) =>
    globs ? globs.some((g) => globToRegex(g).test(f)) : DEFAULT_TEST.test(path.basename(f)),
  );
  const refs = new Map(); // シナリオID -> ファイルの一覧
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(RE.idInText)) {
      if (!refs.has(m[1])) refs.set(m[1], new Set());
      refs.get(m[1]).add(f);
    }
  }
  return refs;
}

// ---------- 集計 ----------

function loadAll() {
  const main = loadSpecsDir(path.join(OS, 'specs'));
  const changesDir = path.join(OS, 'changes');
  const active = dirs(changesDir).filter((d) => d !== 'archive').map((d) => loadChange(path.join(changesDir, d)));
  const archived = dirs(path.join(changesDir, 'archive')).map((d) => loadChange(path.join(changesDir, 'archive', d)));
  return { main, active, archived, manual: loadManualChecks(), readme: loadReadmeCaps(), tests: loadTests() };
}

const scenariosOf = (caps, ops = null) => {
  const s = new Set();
  for (const spec of Object.values(caps))
    for (const r of spec.requirements) if (!ops || ops.includes(r.op)) r.scenarios.forEach((x) => s.add(x));
  return s;
};
const reqIdsOf = (caps, ops = null) => {
  const s = new Set();
  for (const spec of Object.values(caps)) for (const r of spec.requirements) if (!ops || ops.includes(r.op)) s.add(r.id);
  return s;
};
const union = (...sets) => new Set(sets.flatMap((s) => [...s]));

// 変更をアーカイブした後の正式仕様を想定する。
function applyChange(main, change) {
  const result = structuredClone(main);
  for (const [cap, delta] of Object.entries(change.specs)) {
    const spec = result[cap] || { purpose: delta.purpose, requirements: [], formatErrors: [] };
    for (const r of delta.requirements) {
      const idx = spec.requirements.findIndex((x) => x.id === r.id);
      if (r.op === 'REMOVED') {
        if (idx >= 0) spec.requirements.splice(idx, 1);
      } else if (r.op === 'MODIFIED' || r.op === 'ADDED') {
        if (idx >= 0) spec.requirements[idx] = { ...r, op: 'MAIN' };
        else spec.requirements.push({ ...r, op: 'MAIN' });
      }
    }
    result[cap] = spec;
  }
  return result;
}

// 進行中の変更が、正式仕様の capability の要件をすべて削除するか。
function removesCapability(change, cap, main) {
  const delta = change.specs[cap];
  if (!delta || !main[cap]) return false;
  const removed = reqIdsOf({ [cap]: delta }, ['REMOVED']);
  return main[cap].requirements.every((r) => removed.has(r.id));
}

// ---------- 検査 ----------

function checkNormal(d) {
  const errors = [];
  const info = [];
  const owner = new Map();
  for (const [cap, spec] of Object.entries(d.main)) {
    errors.push(...spec.formatErrors);
    for (const r of spec.requirements) {
      if (owner.has(r.id)) errors.push(`正式仕様で ${r.id} が重複している: ${owner.get(r.id)} と ${cap}`);
      else owner.set(r.id, cap);
    }
  }
  const known = union(scenariosOf(d.main), ...d.active.map((c) => scenariosOf(c.specs, ['ADDED', 'MODIFIED'])));
  for (const [id, files] of d.tests)
    if (!known.has(id)) errors.push(`テストが存在しないシナリオID ${id} を参照している: ${[...files].join(', ')}`);
  for (const m of d.manual)
    if (!known.has(m.id)) errors.push(`manual-checks.md が存在しないシナリオID ${m.id} を参照している`);
  if (d.readme === null) {
    if (Object.keys(d.main).length) errors.push('openspec/specs/README.md がない');
  } else {
    for (const cap of Object.keys(d.main))
      if (!d.readme.includes(cap) && !d.active.some((c) => removesCapability(c, cap, d.main)))
        errors.push(`specs/README.md の一覧に ${cap} がない`);
    const allCaps = new Set([...Object.keys(d.main), ...d.active.flatMap((c) => Object.keys(c.specs))]);
    for (const cap of d.readme) if (!allCaps.has(cap)) errors.push(`specs/README.md の ${cap} が、正式仕様にも進行中の変更にもない`);
  }
  const open = d.manual.filter((m) => m.status === '未確認' || m.status === '不合格');
  info.push(`実機確認: 未確認または不合格 ${open.length} 件${open.length ? ` (${open.map((m) => m.id).join(', ')})` : ''}`);
  return { errors, info };
}

function checkStrict(d, name) {
  const change = d.active.find((c) => c.name === name);
  if (!change) return { errors: [`進行中の変更 ${name} がない`], info: [] };
  const { errors, info } = checkNormal(d);
  const others = d.active.filter((c) => c !== change);
  for (const spec of Object.values(change.specs)) errors.push(...spec.formatErrors);

  const removedHere = reqIdsOf(change.specs, ['REMOVED']);
  const usedElsewhere = union(
    reqIdsOf(d.main),
    ...others.map((c) => reqIdsOf(c.specs)),
    ...d.archived.map((c) => reqIdsOf(c.specs)),
  );
  for (const id of reqIdsOf(change.specs, ['ADDED']))
    if (usedElsewhere.has(id) && !removedHere.has(id)) errors.push(`ADDED の ${id} は、すでに使われている`);

  const scnElsewhere = union(scenariosOf(d.main), ...others.map((c) => scenariosOf(c.specs)), ...d.archived.map((c) => scenariosOf(c.specs)));
  for (const [cap, delta] of Object.entries(change.specs))
    for (const r of delta.requirements) {
      if (!['ADDED', 'MODIFIED'].includes(r.op) || removedHere.has(r.id)) continue;
      const before = new Set(d.main[cap]?.requirements.find((x) => x.id === r.id)?.scenarios || []);
      for (const s of r.scenarios) if (!before.has(s) && scnElsewhere.has(s)) errors.push(`新しいシナリオID ${s} は、すでに使われている`);
    }

  for (const [cap, delta] of Object.entries(change.specs))
    if (!d.main[cap] && [...delta.purpose].length < 50)
      errors.push(`新しい capability ${cap} の Purpose が50文字未満 (${[...delta.purpose].length}文字)`);

  const planned = new Map(change.plan.map((p) => [p.id, p]));
  for (const s of scenariosOf(change.specs, ['ADDED', 'MODIFIED'])) {
    const p = planned.get(s);
    if (!p) errors.push(`design の検証計画に ${s} がない`);
    else if (p.method === '自動テスト' && !d.tests.has(s)) errors.push(`${s} を含むテストがない`);
    else if (p.method === '実機確認' && !d.manual.some((m) => m.id === s)) errors.push(`manual-checks.md に ${s} の行がない`);
    else if (!['自動テスト', '実機確認'].includes(p.method)) errors.push(`${s} の検証方法 "${p.method}" が "自動テスト" でも "実機確認" でもない`);
  }
  for (const p of change.plan)
    for (const dec of (p.decision || '').split(/[、,\s]+/).filter(Boolean))
      if (dec !== 'なし' && !change.decisions[dec]) errors.push(`検証計画の ${dec} が、設計判断の見出しにない`);

  const afterMain = applyChange(d.main, change);
  if (d.readme !== null)
    for (const [cap, spec] of Object.entries(afterMain))
      if (spec.requirements.length && !d.readme.includes(cap)) errors.push(`アーカイブ後の capability ${cap} が specs/README.md の一覧にない`);
  const after = union(scenariosOf(afterMain), ...others.map((c) => scenariosOf(c.specs, ['ADDED', 'MODIFIED'])));
  for (const id of d.tests.keys()) if (!after.has(id)) errors.push(`アーカイブ後に存在しない ${id} を、テストが参照している`);
  for (const m of d.manual) if (!after.has(m.id)) errors.push(`アーカイブ後に存在しない ${m.id} を、manual-checks.md が参照している`);

  for (const [id, dec] of Object.entries(change.decisions)) {
    if (dec.promotion === 'なし') continue;
    const doc = dec.promotion.match(/(tech|structure)\.md/);
    if (!doc) errors.push(`${id} の昇格 "${dec.promotion}" が openspec/tech.md または openspec/structure.md の節を指していない`);
    else if (!change.tasks.includes(doc[0])) errors.push(`${id} の昇格先 ${doc[0]} を更新するタスクが tasks.md にない`);
  }
  for (const l of change.stops) errors.push(`proposal の未決事項に停止の項目が残っている: ${l.trim()}`);
  for (const l of change.incompleteTasks) errors.push(`未完了のタスクがある: ${l.trim()}`);
  return { errors, info };
}

// ---------- 台帳と採番 ----------

function generate(d) {
  const manual = new Map(d.manual.map((m) => [m.id, m.status]));
  const out = ['# トレーサビリティ', '', '`openspec-trace.mjs generate` が生成する。\\', '編集せず、コミットしない。', ''];
  out.push('## 要件一覧', '', '| 要件ID | 名称 | capability | シナリオ数 | 自動テストあり | 実機確認 |', '| --- | --- | --- | --- | --- | --- |');
  const scnRows = [];
  for (const [cap, spec] of Object.entries(d.main))
    for (const r of spec.requirements) {
      const tested = r.scenarios.filter((s) => d.tests.has(s)).length;
      const manualStates = r.scenarios.filter((s) => manual.has(s)).map((s) => `${s}: ${manual.get(s)}`);
      out.push(`| ${r.id} | ${r.name} | ${cap} | ${r.scenarios.length} | ${tested} | ${manualStates.join('、') || '-'} |`);
      for (const s of r.scenarios) scnRows.push(`| ${s} | ${[...(d.tests.get(s) || [])].join('、') || '-'} | ${manual.get(s) || '-'} |`);
    }
  out.push('', '## シナリオ一覧', '', '| シナリオID | テストファイル | 実機確認 |', '| --- | --- | --- |', ...scnRows);
  out.push('', '## 変更履歴', '', '| 日付 | 変更名 | 操作 | 要件ID |', '| --- | --- | --- | --- |');
  const opName = { ADDED: '追加', MODIFIED: '変更', REMOVED: '廃止', RENAMED: '名称変更' };
  for (const c of [...d.archived].reverse())
    for (const spec of Object.values(c.specs))
      for (const r of spec.requirements) {
        const [, date = '-', name = c.name] = c.name.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/) || [];
        out.push(`| ${date} | ${name} | ${opName[r.op] || r.op} | ${r.id} |`);
      }
  fs.writeFileSync(path.join(OS, 'traceability.md'), out.join('\n') + '\n');
  return 'openspec/traceability.md を生成した';
}

function nextId(d, reqId) {
  const all = [d.main, ...d.active.map((c) => c.specs), ...d.archived.map((c) => c.specs)];
  if (reqId) {
    let max = 0;
    for (const caps of all)
      for (const s of scenariosOf(caps)) if (s.startsWith(`${reqId}-S`)) max = Math.max(max, Number(s.slice(-2)));
    return `${reqId}-S${String(max + 1).padStart(2, '0')}`;
  }
  const max = { REQ: 0, NREQ: 0 };
  for (const caps of all)
    for (const id of reqIdsOf(caps)) {
      const [kind, num] = id.split('-');
      max[kind] = Math.max(max[kind], Number(num));
    }
  return `REQ-${String(max.REQ + 1).padStart(3, '0')}\nNREQ-${String(max.NREQ + 1).padStart(3, '0')}`;
}

// ---------- 入口 ----------

function main(argv) {
  const [cmd, ...rest] = argv;
  const d = loadAll();
  if (cmd === 'check') {
    const strict = rest.includes('--strict');
    const name = rest[rest.indexOf('--change') + 1];
    if (strict && (!rest.includes('--change') || !name)) {
      console.error('--strict には --change <変更名> が必要');
      return 2;
    }
    const { errors, info } = strict ? checkStrict(d, name) : checkNormal(d);
    info.forEach((m) => console.log(`情報: ${m}`));
    errors.forEach((m) => console.error(`エラー: ${m}`));
    console.log(errors.length ? `${errors.length} 件のエラー` : '問題なし');
    return errors.length ? 1 : 0;
  }
  if (cmd === 'generate') {
    console.log(generate(d));
    return 0;
  }
  if (cmd === 'next-id') {
    console.log(nextId(d, rest[0]));
    return 0;
  }
  console.error('使い方: openspec-trace.mjs check [--strict --change <変更名>] | generate | next-id [<要件ID>]');
  return 2;
}

process.exitCode = main(process.argv.slice(2));
