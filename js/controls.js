// Unified input: keyboard + mouse (pointer lock) and touch (joystick, look pad, buttons).
export class Controls {
  constructor(canvas, touchRoot) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;
    this.enabled = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    this.sensitivity = 1;
    this.invertY = false;

    this.keys = new Set();
    this.lookDX = 0; this.lookDY = 0;
    this.breakHeld = false;
    this.placeQueued = false;
    this.pickQueued = false;
    this.jumpTouch = false; this.downTouch = false; this.sprintTouch = false;
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0 };
    this.lastSpace = 0;
    this.flyToggleQueued = false;
    this.listeners = {};

    this.joyBase = touchRoot.querySelector('.joy-base');
    this.joyKnob = touchRoot.querySelector('.joy-knob');

    this._bindKeyboardMouse();
    this._bindTouch();
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, ...a) { (this.listeners[evt] || []).forEach((f) => f(...a)); }

  setTouchMode(on) {
    this.isTouch = on;
    document.body.classList.toggle('touch', on);
  }

  // ---------------------------------------------------------------- desktop
  _bindKeyboardMouse() {
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      const k = e.code;
      if (k === 'Space') {
        e.preventDefault();
        if (!e.repeat) {
          const now = performance.now();
          if (now - this.lastSpace < 300) this.flyToggleQueued = true;
          this.lastSpace = now;
        }
      }
      if (k.startsWith('Digit')) {
        const n = parseInt(k.slice(5), 10);
        if (n >= 1 && n <= 9) this.emit('slot', n - 1);
      }
      if (k === 'KeyE') this.emit('inventory');
      if (k === 'KeyF') this.flyToggleQueued = true;
      if (k === 'KeyQ' || k === 'Tab') { e.preventDefault(); }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.breakHeld = false; });

    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.isTouch) return;
      if (document.pointerLockElement !== this.canvas) {
        this.requestLock();
        return;
      }
      if (e.button === 0) this.breakHeld = true;
      else if (e.button === 2) this.placeQueued = true;
      else if (e.button === 1) { e.preventDefault(); this.pickQueued = true; }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.breakHeld = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled || document.pointerLockElement !== this.canvas) return;
      // ignore occasional huge spikes some browsers emit on lock
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.lookDX += e.movementX * 0.0022 * this.sensitivity;
      this.lookDY += e.movementY * 0.0022 * this.sensitivity;
    });
    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.emit('scroll', Math.sign(e.deltaY));
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.emit('lockchange', locked);
      if (!locked) this.breakHeld = false;
    });
  }

  requestLock() {
    if (this.isTouch) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* ignore */ }
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---------------------------------------------------------------- touch
  _bindTouch() {
    const root = this.touchRoot;
    const opts = { passive: false };

    const btnFor = (el) => el && el.closest ? el.closest('[data-btn]') : null;

    root.addEventListener('touchstart', (e) => {
      if (!this.isTouch) this.setTouchMode(true);
      e.preventDefault();
      for (const t of e.changedTouches) {
        const btn = btnFor(t.target);
        if (btn) { this._buttonDown(btn, t.identifier); continue; }
        if (t.target.closest && t.target.closest('.no-look')) continue;
        if (t.clientX < window.innerWidth * 0.42 && this.joy.id === null) {
          this.joy.id = t.identifier;
          this.joy.ox = t.clientX; this.joy.oy = t.clientY; this.joy.x = 0; this.joy.y = 0;
          this._showJoy(true);
        } else if (this.look.id === null) {
          this.look.id = t.identifier;
          this.look.x = t.clientX; this.look.y = t.clientY;
        }
      }
    }, opts);

    root.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          const R = 55;
          let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx = dx / d * R; dy = dy / d * R; }
          this.joy.x = dx / R; this.joy.y = dy / R;
          this.sprintTouch = d > R * 1.7;
          this._moveKnob(dx, dy);
        } else if (t.identifier === this.look.id) {
          const dx = t.clientX - this.look.x, dy = t.clientY - this.look.y;
          this.look.x = t.clientX; this.look.y = t.clientY;
          this.lookDX += dx * 0.0065 * this.sensitivity;
          this.lookDY += dy * 0.0065 * this.sensitivity;
        }
      }
    }, opts);

    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null; this.joy.x = 0; this.joy.y = 0; this.sprintTouch = false;
          this._showJoy(false);
        } else if (t.identifier === this.look.id) {
          this.look.id = null;
        }
        this._buttonUp(t.identifier);
      }
    };
    root.addEventListener('touchend', end, opts);
    root.addEventListener('touchcancel', end, opts);

    // Stop iOS double-tap zoom / pinch gestures in-game
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());

    this.activeButtons = new Map();
  }

  _buttonDown(btn, id) {
    const name = btn.dataset.btn;
    this.activeButtons.set(id, btn);
    btn.classList.add('pressed');
    switch (name) {
      case 'jump': this.jumpTouch = true; break;
      case 'down': this.downTouch = true; break;
      case 'break': this.breakHeld = true; break;
      case 'place': this.placeQueued = true; break;
      case 'fly': this.flyToggleQueued = true; break;
      default: this.emit('button', name); break;
    }
  }

  _buttonUp(id) {
    const btn = this.activeButtons.get(id);
    if (!btn) return;
    this.activeButtons.delete(id);
    btn.classList.remove('pressed');
    const name = btn.dataset.btn;
    if (name === 'jump') this.jumpTouch = false;
    if (name === 'down') this.downTouch = false;
    if (name === 'break') this.breakHeld = false;
  }

  _showJoy(on) {
    if (!this.joyBase) return;
    this.joyBase.style.opacity = on ? '1' : '';
    if (on) {
      this.joyBase.style.left = this.joy.ox + 'px';
      this.joyBase.style.top = this.joy.oy + 'px';
      this.joyBase.classList.add('active');
    } else {
      this.joyBase.style.left = ''; this.joyBase.style.top = '';
      this.joyBase.classList.remove('active');
    }
    this._moveKnob(0, 0);
  }

  _moveKnob(dx, dy) {
    if (this.joyKnob) this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // ---------------------------------------------------------------- per-frame
  read() {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) mz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) mz -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (this.joy.id !== null) {
      // small dead zone
      const jx = Math.abs(this.joy.x) < 0.12 ? 0 : this.joy.x;
      const jy = Math.abs(this.joy.y) < 0.12 ? 0 : this.joy.y;
      mx += jx; mz -= jy;
    }
    const out = {
      moveX: mx, moveZ: mz,
      jump: k.has('Space') || this.jumpTouch,
      down: k.has('ShiftLeft') || k.has('ShiftRight') || this.downTouch,
      sprint: k.has('ControlLeft') || k.has('KeyR') || this.sprintTouch,
      lookDX: this.lookDX, lookDY: this.invertY ? -this.lookDY : this.lookDY,
      breakHeld: this.breakHeld,
      place: this.placeQueued,
      pick: this.pickQueued,
      toggleFly: this.flyToggleQueued,
    };
    this.lookDX = 0; this.lookDY = 0;
    this.placeQueued = false; this.pickQueued = false; this.flyToggleQueued = false;
    return out;
  }

  reset() {
    this.keys.clear();
    this.breakHeld = false; this.jumpTouch = false; this.downTouch = false; this.sprintTouch = false;
    this.joy.id = null; this.joy.x = this.joy.y = 0; this.look.id = null;
    for (const btn of this.activeButtons.values()) btn.classList.remove('pressed');
    this.activeButtons.clear();
    this._showJoy(false);
    this.lookDX = this.lookDY = 0;
  }
}
