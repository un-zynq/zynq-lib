/**
 * ZYNQ CORE LIBRARY v1.6.0 
 * Ultra-Stable for Long-Duration Calls (Low CPU / Anti-Lag)
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor() {
        this.events = {};
        this.connections = new Map(); 
        this.calls = new Map();        
        this.activeSessions = new Set();
        this._emittedStates = new Set();
        this.localStream = null;
        this.myId = null;
        this._init();
    }

    _generateId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
    }

    _init() {
        // Gebruik Google's STUN servers voor stabiele long-term verbindingen
        this.peer = new Peer(this._generateId(), {
            config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }, { 'urls': 'stun:stun1.l.google.com:19302' }] },
            debug: 0
        });

        this.peer.on('open', id => { this.myId = id; this._emit('ready', id); });

        // INCOMING DATA
        this.peer.on('connection', conn => {
            conn.on('data', data => this._handleData(conn, data));
            
            // Handshake logic
            setTimeout(() => {
                if (conn.open && !this.activeSessions.has(`${conn.peer}-CHAT`)) {
                    this._setupDataHandlers(conn);
                    this._emit('incoming', {
                        from: conn.peer, type: 'CHAT',
                        accept: () => {
                            conn.send({ _zynq: 'ACCEPTED', _type: 'CHAT' });
                            this._registerSession(conn.peer, 'CHAT');
                            this._emit('accepted', { id: conn.peer, type: 'CHAT' });
                        },
                        reject: () => {
                            conn.send({ _zynq: 'REJECTED', _type: 'CHAT' });
                            this._cleanupConn(conn);
                        }
                    });
                }
            }, 500);
        });

        // INCOMING CALL
        this.peer.on('call', call => {
            this._emit('incoming', {
                from: call.peer, type: 'VIDEO',
                accept: async (lId, rId) => {
                    const s = await this._getMedia();
                    if (!s) return;
                    call.answer(s);
                    this._setupMediaHandlers(call, rId, lId);
                    this._registerSession(call.peer, 'VIDEO');
                    this._emit('accepted', { id: call.peer, type: 'VIDEO' });
                },
                reject: () => {
                    this._emit('rejected', { id: call.peer, type: 'VIDEO' });
                    call.close();
                }
            });
        });

        this.peer.on('error', err => {
            console.error("ZYNQ_PEER_ERROR:", err.type);
            if(err.type === 'peer-unavailable') this._emit('offline', err);
        });
    }

    async _getMedia() {
        if (this.localStream) return this.localStream;
        try {
            // Geoptimaliseerde constraints voor urenlang bellen zonder lag
            this.localStream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, 
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
            });
            return this.localStream;
        } catch (e) {
            this._emit('error', 'MEDIA_FAILED');
            return null;
        }
    }

    _handleData(conn, data) {
        if (!data?._zynq) return this._emit('message', { from: conn.peer, data: data });
        if (data._zynq === 'ACCEPTED') {
            this._registerSession(conn.peer, data._type);
            this._emit('accepted', { id: conn.peer, type: data._type });
        } else if (data._zynq === 'REJECTED' || data._zynq === 'DISCONNECT') {
            this._cleanupConn(conn);
        }
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('close', () => this._cleanupConn(conn));
        conn.on('error', () => this._cleanupConn(conn));
    }

    _setupMediaHandlers(call, rId, lId) {
        this.calls.set(call.peer, call);
        // Directe feedback naar UI
        if(lId) this._handleStream(this.localStream, lId, 'local', 'LOCAL');
        
        call.on('stream', s => this._handleStream(s, rId, call.peer, 'REMOTE'));
        call.on('close', () => this._cleanupCall(call));
        call.on('error', () => this._cleanupCall(call));
    }

    _handleStream(s, eId, pId, type) {
        const el = document.getElementById(eId);
        if (el) {
            el.srcObject = s;
            el.onloadedmetadata = () => el.play().catch(() => {});
        }
        this._emit('stream', { id: pId, type: type, stream: s });
    }

    _cleanupConn(conn) {
        if (!conn) return;
        this.activeSessions.delete(`${conn.peer}-CHAT`);
        this.connections.delete(conn.peer);
        this._emit('disconnected', { id: conn.peer, type: 'CHAT' });
        conn.close();
    }

    _cleanupCall(call) {
        if (!call) return;
        this.activeSessions.delete(`${call.peer}-VIDEO`);
        this.calls.delete(call.peer);
        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        this._emit('disconnected', { id: call.peer, type: 'VIDEO' });
        call.close();
    }

    _emit(e, d) {
        const key = e === 'message' ? null : `${e}-${d?.id || d}-${d?.type || ''}`;
        if (key && this._emittedStates.has(key)) return;
        if (key) { this._emittedStates.add(key); setTimeout(() => this._emittedStates.delete(key), 1000); }
        if (this.events[e]) this.events[e](d);
    }

    on(e, cb) { this.events[e] = cb; }
    _registerSession(id, type) { this.activeSessions.add(`${id}-${type}`); }

    connect(id) {
        if (this.connections.has(id)) return;
        const conn = this.peer.connect(id, { reliable: true });
        this._setupDataHandlers(conn);
    }

    send(id, msg) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(msg); return true; }
        return false;
    }

    async call(id, lId, rId) {
        const s = await this._getMedia();
        if (!s) return;
        const call = this.peer.call(id, s);
        this._setupMediaHandlers(call, rId, lId);
        this._registerSession(id, 'VIDEO');
    }

    disconnect(id) {
        const c = this.connections.get(id);
        if (c) { c.send({ _zynq: 'DISCONNECT' }); setTimeout(() => this._cleanupConn(c), 50); }
        const cl = this.calls.get(id);
        if (cl) this._cleanupCall(cl);
    }
};
