// FAROL - chamadas de CRUD do vault (Path 1). Wrappers finos sobre postJson;
// HttpError (status/body) propaga pro chamador tratar 409/400/404.
import { postJson } from './api.js';

const withMd = (name) => (/\.md$/i.test(name) ? name : name + '.md');
const joinRel = (dir, name) => (dir ? dir.replace(/\/+$/, '') + '/' + name : name);

export function createNote(dir, name) {
  return postJson('/api/note/create', { path: withMd(joinRel(dir, name.trim())) });
}
export function createFolder(dir, name) {
  return postJson('/api/folder/create', { path: joinRel(dir, name.trim()) });
}
export function renameNote(from, to) {
  return postJson('/api/note/rename', { from, to: withMd(to.trim()) });
}
export function deleteNote(path) {
  return postJson('/api/note/delete', { path });
}
export function renameFolder(from, to) {
  return postJson('/api/folder/rename', { from, to: to.trim().replace(/\/+$/, '') });
}
export function deleteFolder(path) {
  return postJson('/api/folder/delete', { path });
}

export function parentDir(path) {
  const i = String(path).lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}
