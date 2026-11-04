// DOM menus, hotbar and inventory.
import { BLOCKS, CREATIVE_BLOCKS, getBlockIcon } from './blocks.js';
import { listWorlds, deleteWorld } from './storage.js';

const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.stack = [];
    this.toastTimer = 0;

    document.querySelectorAll('#menus [data-action]').forEach((el) => {
      el.addEventListener('click', (e) => { e.preventDefault(); this.action(el.dataset.action); });
    });

    $('#create-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const name = f.name.value.trim() || 'My World';
      const seed = f.seed.value.trim();
      const mode = f.mode.value;
      this.game.createWorld({ name, seed, mode });
    });

    this._bindSettings();
    this._buildInventory();

    // Desktop clicks on HUD buttons (touch goes through Controls)
    $('#pause-btn').addEventListener('click', () => this.game.pause());
    $('#inv-btn').addEventListener('click', () => this.game.openInventory());
  }

  // ------------------------------------------------------------- menus
  show(id) {
    document.querySelectorAll('#menus .menu').forEach((m) => m.classList.add('hidden'));
    if (id) $('#menu-' + id).classList.remove('hidden');
    this.current = id;
    if (id === 'worlds') this.renderWorldList();
    if (id === 'settings') this._fillSettings();
    if (id === 'create') {
      const f = $('#create-form');
      f.name.value = 'World ' + (listWorlds().length + 1);
      f.seed.value = '';
    }
  }

  go(id) { this.stack.push(this.current); this.show(id); }
  back() { this.show(this.stack.pop() || (this.game.state === 'playing' || this.game.state === 'paused' ? 'pause' : 'title')); }

  action(name) {
    switch (name) {
      case 'play': {
        const worlds = listWorlds();
        this.go(worlds.length ? 'worlds' : 'create');
        break;
      }
      case 'create': this.go('create'); break;
      case 'settings': this.go('settings'); break;
      case 'back': this.back(); break;
      case 'resume': this.game.resume(); break;
      case 'save': this.game.save(true); break;
      case 'quit': this.game.quitToTitle(); break;
    }
  }

  renderWorldList() {
    const list = $('#world-list');
    list.innerHTML = '';
    const worlds = listWorlds();
    if (!worlds.length) {
      list.innerHTML = '<div class="empty">No saved worlds yet. Create one!</div>';
      return;
    }
    for (const w of worlds) {
      const item = document.createElement('div');
      item.className = 'world-item';
      const icon = w.mode === 'creative' ? 1 : 3;
      const date = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : '';
      item.innerHTML = `<img alt="" src="${getBlockIcon(icon, 48)}"><div class="meta"><div class="name"></div>
        <div class="sub">${w.mode === 'creative' ? 'Creative' : 'Survival'} &middot; ${date}</div></div>`;
      item.querySelector('.name').textContent = w.name;
      const play = document.createElement('button');
      play.className = 'btn primary small'; play.textContent = 'Play';
      play.onclick = () => this.game.loadWorld(w.id);
      const del = document.createElement('button');
      del.className = 'btn danger small'; del.textContent = '✕';
      del.title = 'Delete world';
      del.onclick = () => {
        if (confirm(`Delete "${w.name}"? This cannot be undone.`)) { deleteWorld(w.id); this.renderWorldList(); }
      };
      item.append(play, del);
      list.appendChild(item);
    }
  }

  // ------------------------------------------------------------- settings
  _bindSettings() {
    const f = $('#settings-form');
    const onChange = () => {
      const s = this.game.settings;
      s.renderDistance = +f.renderDistance.value;
      s.sensitivity = +f.sensitivity.value;
      s.fov = +f.fov.value;
      s.dayLength = +f.dayLength.value;
      s.quality = f.quality.value;
      for (const k of ['clouds', 'autoJump', 'viewBob', 'sound', 'showFps', 'invertY']) s[k] = f[k].checked;
      this._updateOutputs();
      this.game.applySettings();
    };
    f.addEventListener('input', onChange);
    f.addEventListener('change', onChange);
  }

  _fillSettings() {
    const f = $('#settings-form');
    const s = this.game.settings;
    f.renderDistance.value = s.renderDistance;
    f.sensitivity.value = s.sensitivity;
    f.fov.value = s.fov;
    f.dayLength.value = s.dayLength;
    f.quality.value = s.quality;
    for (const k of ['clouds', 'autoJump', 'viewBob', 'sound', 'showFps', 'invertY']) f[k].checked = !!s[k];
    this._updateOutputs();
  }

  _updateOutputs() {
    const s = this.game.settings;
    const fmt = {
      renderDistance: `${s.renderDistance} chunks`, sensitivity: s.sensitivity.toFixed(1) + '×',
      fov: s.fov + '°', dayLength: Math.round(s.dayLength / 60) + ' min',
    };
    document.querySelectorAll('#settings-form output').forEach((o) => { o.textContent = fmt[o.dataset.for]; });
  }

  // ------------------------------------------------------------- hotbar
  renderHotbar(slots, selected, creative) {
    const bar = $('#hotbar');
    if (bar.children.length !== slots.length) {
      bar.innerHTML = '';
      slots.forEach((_, i) => {
        const s = document.createElement('div');
        s.className = 'slot';
        s.dataset.btn = 'slot:' + i;
        s.innerHTML = `<span class="key">${i + 1}</span><img alt=""><span class="count"></span>`;
        s.addEventListener('click', () => this.game.selectSlot(i));
        bar.appendChild(s);
      });
    }
    slots.forEach((slot, i) => {
      const el = bar.children[i];
      el.classList.toggle('selected', i === selected);
      const img = el.querySelector('img');
      const cnt = el.querySelector('.count');
      if (slot && slot.id) {
        const src = getBlockIcon(slot.id, 64);
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.style.visibility = 'visible';
        cnt.textContent = creative ? '' : (slot.count > 1 ? slot.count : '');
      } else {
        img.style.visibility = 'hidden';
        cnt.textContent = '';
      }
    });
  }

  _buildInventory() {
    const grid = $('#inventory-grid');
    for (const id of CREATIVE_BLOCKS) {
      const it = document.createElement('div');
      it.className = 'inv-item';
      it.title = BLOCKS[id].name;
      it.innerHTML = `<img alt="${BLOCKS[id].name}" src="${getBlockIcon(id, 64)}">`;
      it.addEventListener('click', () => {
        this.game.setSlotBlock(id);
        this.toast(BLOCKS[id].name);
      });
      grid.appendChild(it);
    }
  }

  toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
  }

  setLoading(p, text) {
    $('#loading-bar').style.width = Math.round(p * 100) + '%';
    if (text) $('#loading-text').textContent = text;
  }
}
