// World save/load + settings in localStorage. All access is guarded so the
// game still runs in private mode or when storage is full.
const PREFIX = 'blockworld.';
const INDEX = PREFIX + 'worlds';
const SETTINGS = PREFIX + 'settings';

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (_) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) {
    console.warn('BlockWorld: could not save', key, e);
    return false;
  }
}

export function listWorlds() {
  const list = read(INDEX, []);
  return Array.isArray(list) ? list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)) : [];
}

export function loadWorld(id) { return read(PREFIX + 'world.' + id, null); }

export function saveWorld(state) {
  const ok = write(PREFIX + 'world.' + state.id, state);
  const list = listWorlds().filter((w) => w.id !== state.id);
  list.push({ id: state.id, name: state.name, mode: state.mode, seed: state.seed, created: state.created, lastPlayed: Date.now() });
  write(INDEX, list);
  return ok;
}

export function deleteWorld(id) {
  try { localStorage.removeItem(PREFIX + 'world.' + id); } catch (_) { /* ignore */ }
  write(INDEX, listWorlds().filter((w) => w.id !== id));
}

export function newWorldId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const DEFAULT_SETTINGS = {
  renderDistance: isTouch ? 3 : 5,
  sensitivity: 1,
  fov: 75,
  quality: isTouch ? 'medium' : 'high',
  clouds: true,
  autoJump: true,
  viewBob: true,
  sound: true,
  showFps: false,
  invertY: false,
  dayLength: 600,
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...read(SETTINGS, {}) };
}
export function saveSettings(s) { write(SETTINGS, s); }
