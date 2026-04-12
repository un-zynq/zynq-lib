class EventEmitter {
  constructor() {
    this._events = {};
  }
  on(name, fn) {
    (this._events[name] = this._events[name] || []).push(fn);
    return this;
  }
  emit(name, data) {
    if (this._events[name]) {
      this._events[name].forEach(fn => fn(data));
    }
  }
}

class ZYNQPeer extends EventEmitter {
  static _loadingPromise = null;
  static _ensurePeerJS() {
    if (typeof Peer !== "undefined") return Promise.resolve();
    if (ZYNQPeer._loadingPromise) return ZYNQPeer._loadingPromise;
    ZYNQPeer._loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load PeerJS"));
      document.head.appendChild(script);
    });
    return ZYNQPeer._loadingPromise;
  }
  static _instances = new Map();
  static get(remoteId, config = {}) {
    if (!remoteId) throw new Error('remoteId is required for ZYNQPeer.get');
    if (!ZYNQPeer._instances.has(remoteId)) {
      const engine = new ZYNQPeer(config);
      engine._remoteId = remoteId;
      ZYNQPeer._instances.set(remoteId, engine);
    }
    return ZYNQPeer._instances.get(remoteId);
  }
  static destroyAll() {
    for (const engine of ZYNQPeer._instances.values()) engine.destroy();
    ZYNQPeer._instances.clear();
  }
  constructor(config = {}) {
    super();
    this.config = {
      txt: true,
      video: true,
      audio: true,
      debug: false,
      rateLimit: 30,
      maxMsgSize: 65536,
      autoReconnect: true,
      maxReconnectAttempts: 5,
      id: null,
      ...config
    };
    this.peer = null;
    this.id = null;
    this._remoteId = null;
    this._dataConn = null;
    this._mediaCall = null;
    this.localStream = null;
    this.state = 'DISCONNECTED';
    this.active = false;
    this._reconnectAttempts = 0;
    this._reconnectTimeout = null;
    this._manualClose = false;
    this._messageTimestamps = [];
    this._dataQueue = [];
    this._flushScheduled = false;
    ZYNQPeer._ensurePeerJS().then(() => {
      this.peer = this.config.id ? new Peer(this.config.id) : new Peer();
      this.peer.on('open', id => {
        this.id = id;
        this.emit('ready', id);
        this.state = 'DISCONNECTED';
      });
      this.peer.on('connection', c => this._handleIncomingConnection(c));
      this.peer.on('call', call => this._handleIncomingCall(call));
      this.peer.on('error', err => this.emit('error', { type: 'peer', error: err }));
      this.peer.on('disconnected', () => {});
    }).catch(err => this.emit('error', { type: 'peer', error: err }));
  }
  async getStream() {
    if (this.localStream) return this.localStream;
    if (!this.config.video && !this.config.audio) return null;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: this.config.video,
        audio: this.config.audio
      });
      this.emit('localStream', this.localStream);
      return this.localStream;
    } catch (e) {
      return null;
    }
  }
  _setupDataConnection(conn) {
    if (this._dataConn && this._dataConn.open) {
      conn.close();
      return;
    }
    this._dataConn = conn;
    this._remoteId = conn.peer;
    conn.on('data', data => {
      if (typeof data !== "string" || data.length > this.config.maxMsgSize) return;
      const now = Date.now();
      this._messageTimestamps = this._messageTimestamps.filter(ts => now - ts < 1000);
      if (this._messageTimestamps.length >= this.config.rateLimit) return;
      this._messageTimestamps.push(now);
      this._dataQueue.push(data);
      this._scheduleFlush();
    });
    conn.on('open', () => {
      this.active = true;
      this.state = 'CONNECTED';
      this._reconnectAttempts = 0;
      this._manualClose = false;
      this.emit('open', this._remoteId);
    });
    conn.on('close', () => this._handleClose());
    conn.on('error', e => this.emit('error', { type: 'data', error: e }));
    if (conn.open) {
      this.active = true;
      this.state = 'CONNECTED';
      this.emit('open', this._remoteId);
    }
  }
  _scheduleFlush() {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    Promise.resolve().then(() => this._flushData());
  }
  _flushData() {
    this._flushScheduled = false;
    if (!this._dataQueue.length) return;
    const msgs = [...this._dataQueue];
    this._dataQueue = [];
    msgs.forEach(msg => this.emit('data', msg));
  }
  _handleIncomingConnection(c) {
    this._setupDataConnection(c);
  }
  _handleIncomingCall(call) {
    if (!this.config.video && !this.config.audio) {
      call.close();
      return;
    }
    this.getStream().then(stream => {
      if (!stream) {
        call.close();
        return;
      }
      call.answer(stream);
      this._mediaCall = call;
      call.on('stream', s => this.emit('stream', s));
      call.on('close', () => this._handleClose());
      call.on('error', e => this.emit('error', { type: 'media', error: e }));
    });
  }
  _handleClose() {
    this.active = false;
    this.state = 'DISCONNECTED';
    this.emit('close', this._remoteId);
    this._dataConn = null;
    if (this._manualClose) {
      this._manualClose = false;
      return;
    }
    if (this.config.autoReconnect && this._remoteId) {
      this.state = 'RECONNECTING';
      this._attemptReconnect();
    }
  }
  _attemptReconnect() {
    if (this._reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.state = 'FAILED';
      this.emit('error', { type: 'reconnect_failed', code: 'max_attempts_reached' });
      return;
    }
    this._reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this._reconnectAttempts - 1), 30000) + Math.random() * 1000;
    this.emit('reconnecting', { attempt: this._reconnectAttempts, delay: Math.round(delay) });
    this._reconnectTimeout = setTimeout(() => {
      if (this.state !== 'RECONNECTING') return;
      this.connect(this._remoteId);
    }, delay);
  }
  connect(remoteId) {
    if (remoteId) this._remoteId = remoteId;
    if (!this._remoteId) return this;
    if (this._remoteId === this.id) return this;
    if (this._reconnectTimeout) {
      clearTimeout(this._reconnectTimeout);
      this._reconnectTimeout = null;
    }
    this.state = 'CONNECTING';
    if (this.config.txt) {
      const conn = this.peer.connect(this._remoteId, { reliable: true });
      conn.on('open', () => this._setupDataConnection(conn));
      conn.on('error', e => this.emit('error', { type: 'data', error: e }));
    }
    if (this.config.video || this.config.audio) {
      this.getStream().then(stream => {
        if (stream) {
          const call = this.peer.call(this._remoteId, stream);
          this._mediaCall = call;
          call.on('stream', s => this.emit('stream', s));
          call.on('close', () => this._handleClose());
          call.on('error', e => this.emit('error', { type: 'media', error: e }));
        }
      });
    }
    return this;
  }
  send(msg) {
    if (!this._dataConn || !this._dataConn.open) return;
    this._dataConn.send(msg);
    this.emit('sent', msg);
  }
  close() {
    this._manualClose = true;
    if (this._dataConn) this._dataConn.close();
    if (this._mediaCall) this._mediaCall.close();
    this._handleClose();
  }
  destroy() {
    this.close();
    if (this.peer) this.peer.destroy();
    if (this._remoteId) ZYNQPeer._instances.delete(this._remoteId);
  }
}

class ZYNQ_Core {
  constructor() {
    this.config = {
      src: "https://cdn.jsdelivr.net/gh/un-zynq/zynq-lib@1.0/games.json",
      cdn: "https://cdn.jsdelivr.net/gh/un-zynq/thumbnails",
    };
    this.all = [];
    this.filtered = [];
    this.favorites = this._initStorage();
    this.deviceType = 2;
    this.history = this._initHistory();
  }
  async init(options = {}) {
    const { mode = "all", search = "", sort = "name", src = this.config.src, cdn = this.config.cdn } = options;
    this.config.src = src;
    this.config.cdn = cdn;
    this._detectDevice();
    await this._loadData(sort);
    if (search) this.search(search);
    if (mode === "supported") this.filterSupported();
    if (mode === "favs") this.filterFavorites();
    return this;
  }
  _detectDevice() {
    const n = navigator;
    const ua = n.userAgent;
    const touchPoints = n.maxTouchPoints || 0;
    const hasFinePointer = window.matchMedia("(pointer: fine)").matches;
    const hasHover = window.matchMedia("(hover: hover)").matches;
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : "";
    let scores = { desktop: 0, mobile: 0 };
    if (/Win|Mac|Linux/i.test(ua)) scores.desktop += 15;
    if (ua.includes("x64") || ua.includes("wow64")) scores.desktop += 10;
    if (hasFinePointer && hasHover) scores.desktop += 20;
    if (/Intel|Nvidia|AMD|Direct3D|GeForce/i.test(renderer)) scores.desktop += 25;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) scores.mobile += 20;
    if (/Adreno|Mali|PowerVR|Apple GPU/i.test(renderer)) scores.mobile += 25;
    if (scores.desktop > scores.mobile) {
      this.deviceType = touchPoints > 0 ? 1 : 2;
    } else if (/Macintosh/i.test(ua) && touchPoints > 1) {
      this.deviceType = 4;
    } else {
      const isLarge = window.screen.width >= 1024 || (window.screen.width >= 768 && touchPoints > 1);
      this.deviceType = isLarge ? 4 : 3;
    }
    window.ZYNQ.deviceType = this.deviceType;
  }
  async _loadData(sortKey) {
    try {
      const response = await fetch(this.config.src);
      const data = await response.json();
      const library = [];
      data.forEach((category) => {
        Object.entries(category).forEach(([base, games]) => {
          Object.entries(games).forEach(([alias, meta]) => {
            library.push({
              name: meta.name || alias,
              category: meta.category || undefined,
              alias: alias,
              url: `${base}/${alias}`,
              thumb: `${this.config.cdn}/${base}/${alias}.webp`,
              devices: meta.devices ? String(meta.devices).split(",").map(Number) : [],
              get isSupported() {
                return window.ZYNQ.deviceType === null || (this.devices?.includes(window.ZYNQ.deviceType) ?? true);
              },
              get isFavorite() {
                return window.ZYNQ.games.isFavorite(this.alias);
              }
            });
          });
        });
      });
      this.all = library.sort((a, b) => (a[sortKey] || "").localeCompare(b[sortKey] || ""));
      this.filtered = [...this.all];
    } catch (err) {
      console.error("ZYNQ Core Load Error:", err);
    }
  }
  search(query) {
    const q = query?.toLowerCase().trim();
    this.filtered = q ? this.all.filter(g =>
      g.name.toLowerCase().includes(q) || g.alias.toLowerCase().includes(q)
    ) : [...this.all];
    return this;
  }
  random(limit = 1) {
    const source = this.filtered.length > 0 ? this.filtered : this.all;
    this.filtered = [...source].sort(() => Math.random() - 0.5).slice(0, limit);
    return this;
  }
  getRandomOne() {
    const source = this.filtered.length > 0 ? this.filtered : this.all;
    return source[Math.floor(Math.random() * source.length)];
  }
  shuffle() {
    const arr = this.filtered.length > 0 ? this.filtered : this.all;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.filtered = arr;
    return this;
  }
  sortBy(key = "name") {
    this.filtered.sort((a, b) => (a[key] || "").localeCompare(b[key] || ""));
    return this;
  }
  sortByPopularity() {
    this.filtered.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
    return this;
  }
  getByAlias(alias) {
    return this.all.find(game => game.alias === alias) || null;
  }
  getByCategory(category) {
    this.filtered = this.all.filter(game => game.category === category);
    return this;
  }
  filterSupported() {
    this.filtered = this.filtered.filter(g => g.isSupported);
    return this;
  }
  filterFavorites() {
    this.filtered = this.filtered.filter(g => g.isFavorite);
    return this;
  }
  addToHistory(alias) {
    this.history = [alias, ...this.history.filter(a => a !== alias)].slice(0, 50);
    localStorage.setItem("ZYNQ_history", JSON.stringify(this.history));
    return this;
  }
  getHistory() {
    return this.history.map(alias => this.getByAlias(alias)).filter(Boolean);
  }
  clearHistory() {
    this.history = [];
    localStorage.removeItem("ZYNQ_history");
    return this;
  }
  reset() {
    this.filtered = [...this.all];
    return this;
  }
  isFavorite(alias) {
    return this.favorites.has(alias);
  }
  toggleFavorite(alias) {
    this.favorites.has(alias) ? this.favorites.delete(alias) : this.favorites.add(alias);
    localStorage.setItem("ZYNQ_favs", JSON.stringify([...this.favorites]));
    return this;
  }
  get list() { return this.filtered; }
  get total() { return this.all.length; }
  get filteredCount() { return this.filtered.length; }
  _initStorage() {
    try {
      const data = localStorage.getItem("ZYNQ_favs");
      return new Set(data ? JSON.parse(data) : []);
    } catch { return new Set(); }
  }
  _initHistory() {
    try {
      const data = localStorage.getItem("ZYNQ_history");
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }
}

const ZYNQ = {
  games: new ZYNQ_Core(),
  deviceType: null,
  Peer: ZYNQPeer,
  peer: ZYNQPeer,
  EventEmitter: EventEmitter
};
window.ZYNQ = ZYNQ;
export default ZYNQ;
export { ZYNQPeer as Peer };
export { EventEmitter };
export const games = ZYNQ.games;
export const peer = ZYNQ.Peer;
export { ZYNQPeer as defaultPeer };
