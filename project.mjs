import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

// ★EntryRoot 저장 변환은 내보낼 때마다 새 zs_ 번호(블록 id, 편집 정보 리스트 안의 id)를 붙인다.
//   같은 작품이 매번 다른 해시가 되지 않게 비교 전에 그 번호만 지운다. 확장(authoring.js, background.js)도 같은 규칙 — 세 곳을 같이 바꾼다.
const GENERATED_ID = /"(zcol)?zs_[0-9a-z]+"/g;
const maskText = (text) => (typeof text === 'string' ? text.replace(GENERATED_ID, '"$1zs_"') : text);
function maskScriptIds(project) {
  if (!project || typeof project !== 'object') return project;
  const out = { ...project };
  if (Array.isArray(project.objects)) out.objects = project.objects.map((o) => (typeof o?.script === 'string' ? { ...o, script: maskText(o.script) } : o));
  if (Array.isArray(project.functions)) out.functions = project.functions.map((f) => (typeof f?.content === 'string' ? { ...f, content: maskText(f.content) } : f));
  if (Array.isArray(project.variables)) out.variables = project.variables.map((v) => (Array.isArray(v?.array)
    ? { ...v, array: v.array.map((i) => (typeof i?.data === 'string' ? { ...i, data: maskText(i.data) } : i)) } : v));
  return out;
}
// ★표의 updated와 행 key는 작품을 다시 불러올 때 새로 정해지는 값이라 내용 비교에서 뺀다. 확장도 같은 규칙.
const maskTableRow = (row) => {
  if (!row || typeof row !== 'object') return row;
  const { key, ...rest } = row;
  return rest;
};
const maskTable = (table) => {
  if (!table || typeof table !== 'object') return table;
  const { updated, ...rest } = table;
  return Array.isArray(table.data) ? { ...rest, data: table.data.map(maskTableRow) } : rest;
};
export function maskGeneratedIds(project) {
  const out = maskScriptIds(project);
  if (out && Array.isArray(out.tables)) out.tables = out.tables.map(maskTable);
  return out;
}
const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const hashProject = (project) => sha256(maskGeneratedIds(project));
// 이 규칙들 이전에 저장한 체크포인트 파일 이름을 계속 받기 위한 것.
export const hashRawProject = (project) => sha256(project);
export const hashScriptMaskedProject = (project) => sha256(maskScriptIds(project));

export function summarizeProject(project) {
  return {
    name: project.name,
    scenes: (project.scenes || []).map(({ id, name }) => ({ id, name })),
    objects: (project.objects || []).map(({ id, name, scene, objectType, script, sprite }) => ({
      id, name, scene, objectType,
      scriptBytes: typeof script === 'string' ? script.length : null,
      pictures: sprite?.pictures?.length || 0,
      sounds: sprite?.sounds?.length || 0,
    })),
    variables: (project.variables || []).map(({ id, name, variableType }) => ({ id, name, variableType })),
    messages: (project.messages || []).length,
    functions: (project.functions || []).length,
    tables: (project.tables || []).length,
  };
}

// ★현재 Entry의 .ent 실측 형식: gzip 안의 tar, temp/project.json.
export async function readEntProject(file) {
  const input = await readFile(file);
  if (input.length > 50_000_000) throw new Error('ENT_FILE_TOO_LARGE');
  const tar = gunzipSync(input, { maxOutputLength: 200_000_000 });
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString('ascii').split('\0')[0].trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
      throw new Error('ENT_TAR_ENTRY_INVALID');
    }
    if (name === 'temp/project.json') {
      return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString('utf8'));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('ENT_PROJECT_JSON_MISSING');
}

export const changedPaths = (before, after) => pathsBetween(maskGeneratedIds(before), maskGeneratedIds(after), '');

function pathsBetween(before, after, prefix) {
  if (Object.is(before, after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [prefix || '/'];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => pathsBetween(before[key], after[key], `${prefix}/${key}`));
}
