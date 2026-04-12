class EventEmitter {
    constructor() {
        this._events = {};
    }
    on(name, fn) {
        (this._events[name] = this._events[name] || []).push(fn);
        return this;
    }
    emit(name, data) {
        if (this._events[name]) this._events[name].forEach(fn => fn(data));
    }
}
class ZYNQPeer extends EventEmitter {
    static _instance = null;
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
    static get(remoteId, config = {}) {
        if (!ZYNQPeer._instance) {
            ZYNQPeer._instance = new ZYNQPeer(config);
        }
        return ZYNQPeer._instance;
    }
    static destroyAll() {
        if (ZYNQPeer._instance) {
            ZYNQPeer._instance.destroy();
            ZYNQPeer._instance = null;
        }
    }
    constructor(config = {}) {
        super();
        this.config = {
            video: true,
            audio: true,
            txt: true,
            debug: false,
            rateLimit: 30,
            maxMsgSize: 65536,
            autoReconnect: true,
            maxReconnectAttempts: 5,
            rafBatching: false,
            id: null,
            ...config
        };
        this.peer = null;
        this.localStream = null;
        this.localConstraints = null;
        this.id = null;
        this._messageTimestamps = [];
        this._maxMsgSize = this.config.maxMsgSize;
        this._rateLimit = this.config.rateLimit;
        this._conns = new Map();
        this._calls = new Map();
        this._pendingMsgs = new Map();
        this._dataQueue = [];
        this._flushScheduled = false;
        this._reconnectAttempts = new Map();
        this._reconnectTimeouts = new Map();
        this._manualCloses = new Set();
        this._connecting = new Set();
        ZYNQPeer._ensurePeerJS().then(() => {
            this.peer = this.config.id ? new Peer(this.config.id) : new Peer();
            this.peer.on('open', id => {
                this.id = id;
                this.emit('ready', id);
            });
            this.peer.on('connection', c => this._handleIncomingConnection(c));
            this.peer.on('call', call => this._handleIncomingCall(call));
            this.peer.on('error', err => this.emit('error', {
                type: 'peer',
                error: err
            }));
            this.peer.on('disconnected', () => {});
        }).catch(err => this.emit('error', {
            type: 'peer',
            error: err
        }));
    }
    async getStream(opts = {}) {
        const video = opts.video !== undefined ? opts.video : this.config.video;
        const audio = opts.audio !== undefined ? opts.audio : this.config.audio;
        if (this.localStream && this.localConstraints && this.localConstraints.video === video && this.localConstraints.audio === audio) {
            return this.localStream;
        }
        if (this.localStream && this._calls.size > 0) {
            return this.localStream;
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            this.localConstraints = null;
        }
        if (!video && !audio) return null;
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: video,
                audio: audio
            });
            this.localConstraints = {
                video: video,
                audio: audio
            };
            return this.localStream;
        } catch (e) {
            this.localConstraints = null;
            return null;
        }
    }
    _setupDataConnection(conn) {
        const peerId = conn.peer;
        if (this._conns.has(peerId) && this._conns.get(peerId).open) {
            conn.close();
            return;
        }
        this._conns.set(peerId, conn);
        conn.on('data', d => {
            const now = Date.now();
            this._messageTimestamps = this._messageTimestamps.filter(ts => now - ts < 1000);
            if (this._messageTimestamps.length >= this._rateLimit) return;
            this._messageTimestamps.push(now);
            this._dataQueue.push({
                from: peerId,
                type: 'data',
                data: d
            });
            this._scheduleFlush();
        });
        conn.on('open', () => {
            this.emit('open', peerId);
            this._reconnectAttempts.delete(peerId);
            this._reconnectTimeouts.delete(peerId);
            this._connecting.delete(peerId);
            const pending = this._pendingMsgs.get(peerId) || [];
            pending.forEach(m => conn.send(m));
            this._pendingMsgs.delete(peerId);
        });
        conn.on('close', () => this._handleDataConnectionClose(peerId));
        conn.on('error', e => {
            this.emit('error', {
                type: 'data',
                id: peerId,
                error: e
            });
            this._connecting.delete(peerId);
        });
        if (conn.open) {
            this.emit('open', peerId);
        }
    }
    _scheduleFlush() {
        if (this._flushScheduled) return;
        this._flushScheduled = true;
        const flushFn = () => this._flushData();
        if (this.config.rafBatching && typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(flushFn);
        } else {
            Promise.resolve().then(flushFn);
        }
    }
    _flushData() {
        this._flushScheduled = false;
        if (this._dataQueue.length === 0) return;
        const messages = [...this._dataQueue];
        this._dataQueue = [];
        messages.forEach(m => this.emit('message', m));
    }
    _handleIncomingConnection(c) {
        this._setupDataConnection(c);
    }
    _handleIncomingCall(call) {
        const peerId = call.peer;
        if (!this.config.video && !this.config.audio) {
            call.close();
            return;
        }
        this.getStream().then(s => {
            if (!s) {
                call.close();
                return;
            }
            call.answer(s);
            this._calls.set(peerId, call);
            call.on('stream', stream => this.emit('stream', {
                from: peerId,
                stream
            }));
            call.on('close', () => this._handleMediaConnectionClose(peerId));
            call.on('error', e => this.emit('error', {
                type: 'media',
                id: peerId,
                error: e
            }));
        });
    }
    _handleDataConnectionClose(peerId) {
        this._conns.delete(peerId);
        this._connecting.delete(peerId);
        if (this._calls.has(peerId)) return;
        this._fullPeerDisconnect(peerId);
    }
    _handleMediaConnectionClose(peerId) {
        this._calls.delete(peerId);
        if (this._conns.has(peerId)) return;
        this._fullPeerDisconnect(peerId);
    }
    _fullPeerDisconnect(peerId) {
        const wasManual = this._manualCloses.has(peerId);
        this._manualCloses.delete(peerId);
        this.emit('close', {
            id: peerId
        });
        if (wasManual) return;
        if (this.config.autoReconnect) {
            this._attemptReconnect(peerId);
        } else {
            this.emit('disconnect', {
                id: peerId
            });
        }
    }
    _attemptReconnect(peerId) {
        if (this._reconnectTimeouts.has(peerId)) return;
        let attempts = this._reconnectAttempts.get(peerId) || 0;
        if (attempts >= this.config.maxReconnectAttempts) {
            this.emit('error', {
                type: 'reconnect_failed',
                id: peerId
            });
            this.emit('disconnect', {
                id: peerId
            });
            this._reconnectAttempts.delete(peerId);
            return;
        }
        attempts++;
        this._reconnectAttempts.set(peerId, attempts);
        const baseDelay = 1000 * Math.pow(2, attempts - 1);
        const delay = Math.min(baseDelay, 30000) + Math.random() * 1000;
        this.emit('reconnecting', {
            id: peerId,
            attempt: attempts,
            delay: Math.round(delay)
        });
        const timeout = setTimeout(() => {
            if (this._reconnectTimeouts.get(peerId) !== timeout) return;
            this._reconnectTimeouts.delete(peerId);
            this._connectTo(peerId);
        }, delay);
        this._reconnectTimeouts.set(peerId, timeout);
    }
    _connectTo(id) {
        if (!id || id === this.id || !this.peer) return;
        if (this._conns.has(id) && this._conns.get(id).open) return;
        if (this._connecting.has(id)) return;
        if (this.config.txt) {
            this._connecting.add(id);
            const conn = this.peer.connect(id, {
                reliable: true
            });
            this._setupDataConnection(conn);
        }
    }
    send(id, msg) {
        if (!this.peer || !this.id) return;
        if (id === "*") {
            for (const [pid, conn] of this._conns) {
                if (conn && conn.open) conn.send(msg);
            }
            return;
        }
        const conn = this._conns.get(id);
        if (conn && conn.open) {
            conn.send(msg);
            return;
        }
        if (!this._pendingMsgs.has(id)) this._pendingMsgs.set(id, []);
        const queue = this._pendingMsgs.get(id);
        queue.push(msg);
        if (queue.length > 50) queue.shift();
        this._connectTo(id);
    }
    call(id, opts = {}) {
        if (!id || id === "*" || id === this.id || !this.peer) return this;
        const video = opts.video !== undefined ? opts.video : this.config.video;
        const audio = opts.audio !== undefined ? opts.audio : this.config.audio;
        if (!video && !audio) return this;
        this.getStream({
            video,
            audio
        }).then(stream => {
            if (!stream) return;
            const callObj = this.peer.call(id, stream);
            this._calls.set(id, callObj);
            callObj.on('stream', s => this.emit('stream', {
                from: id,
                stream: s
            }));
            callObj.on('close', () => this._handleMediaConnectionClose(id));
            callObj.on('error', e => this.emit('error', {
                type: 'media',
                id: id,
                error: e
            }));
        });
        return this;
    }
    hangup(id) {
        const call = this._calls.get(id);
        if (call) {
            this._manualCloses.add(id);
            call.close();
        }
    }
    connect(id) {
        if (id) this._connectTo(id);
        return this;
    }
    close() {
        this._manualCloses = new Set([...this._conns.keys(), ...this._calls.keys()]);
        for (const conn of this._conns.values()) {
            if (conn) conn.close();
        }
        for (const call of this._calls.values()) {
            if (call) call.close();
        }
        return this;
    }
    destroy() {
        for (const conn of this._conns.values()) {
            if (conn) conn.close();
        }
        for (const call of this._calls.values()) {
            if (call) call.close();
        }
        for (const t of this._reconnectTimeouts.values()) {
            clearTimeout(t);
        }
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            this.localConstraints = null;
        }
        this._conns.clear();
        this._calls.clear();
        this._pendingMsgs.clear();
        this._reconnectAttempts.clear();
        this._reconnectTimeouts.clear();
        this._manualCloses.clear();
        this._connecting.clear();
        this._dataQueue = [];
        this._flushScheduled = false;
        this._messageTimestamps = [];
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
    }
}
class ZYNQGames {
    constructor() {
        this.config = {
            src: "https://cdn.jsdelivr.net/gh/un-zynq/zynq-lib@1.0.9/games.json",
            cdn: "https://cdn.jsdelivr.net/gh/un-zynq/thumbnails",
        };
        this.all = [];
        this.filtered = [];
        this.favorites = this._initStorage();
        this.deviceType = 2;
        this.history = this._initHistory();
    }
    async init(options = {}) {
        const {
            mode = "all", search = "", sort = "name", src = this.config.src, cdn = this.config.cdn
        } = options;
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
        let scores = {
            desktop: 0,
            mobile: 0
        };
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
        this.filtered = q ? this.all.filter(g => g.name.toLowerCase().includes(q) || g.alias.toLowerCase().includes(q)) : [...this.all];
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
    get list() {
        return this.filtered;
    }
    get total() {
        return this.all.length;
    }
    get filteredCount() {
        return this.filtered.length;
    }
    _initStorage() {
        try {
            const data = localStorage.getItem("ZYNQ_favs");
            return new Set(data ? JSON.parse(data) : []);
        } catch {
            return new Set();
        }
    }
    _initHistory() {
        try {
            const data = localStorage.getItem("ZYNQ_history");
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }
}
const ZYNQ = {
    games: new ZYNQGames(),
    deviceType: null,
    Peer: ZYNQPeer,
    peer: ZYNQPeer,
    EventEmitter: EventEmitter
};
window.ZYNQ = ZYNQ;
export default ZYNQ;
export {
    ZYNQPeer as Peer
};
export {
    EventEmitter
};
export const games = ZYNQ.games;
export const peer = ZYNQ.Peer;
export {
    ZYNQPeer as defaultPeer
};
