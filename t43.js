/**
 * ZYNQ Core Library
 * Version: 1.2.2
 * Universal disconnect logic & automated cleanup.
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor() {
        this.events = {};
        this.connections = new Map(); 
        this.calls = new Map();       
        this.activeSessions = new Set();
        this.myId = null;
        this._init(this._generateId());
    }

    _generateId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
    }

    async _init(id) {
        if (!window.Peer) {
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r; document.head.appendChild(s);
            });
        }

        this.peer = new Peer(id);

        this.peer.on('open', (assignedId) => {
            this.myId = assignedId;
            this._emit('ready', assignedId);
        });

        // Incoming Handlers
        this.peer.on('connection', (conn) => {
            this._setupDataHandlers(conn);
            this._emit('incoming', { 
                from: conn.peer, type: 'CHAT',
                accept: () => {
                    conn.send({ _zynq: 'ACCEPTED' });
                    this._registerSession(conn.peer, 'CHAT');
                    this._emit('accepted', { id: conn.peer, type: 'CHAT', by: this.myId });
                },
                reject: () => {
                    conn.send({ _zynq: 'REJECTED' });
                    this._emit('rejected', { id: conn.peer, type: 'CHAT', by: this.myId });
                    setTimeout(() => conn.close(), 100);
                }
            });
        });

        this.peer.on('call', (call) => {
            this._setupMediaHandlers(call, null); // remoteId later determined by UI
            this._emit('incoming', {
                from: call.peer, type: 'VIDEO',
                accept: async (lId, rId) => {
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    const localEl = document.getElementById(lId);
                    if (localEl) localEl.srcObject = s;
                    call.answer(s);
                    this._setupMediaHandlers(call, rId);
                    this._emit('accepted', { id: call.peer, type: 'VIDEO', by: this.myId });
                },
                reject: () => {
                    call.close();
                    this._emit('rejected', { id: call.peer, type: 'VIDEO', by: this.myId });
                }
            });
        });
    }

    _registerSession(id, type) {
        const key = `${id}-${type}`;
        if (this.activeSessions.has(key)) return;
        this.activeSessions.add(key);
        this._emit('session_start', { id, type });
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        
        conn.on('data', (data) => {
            if (data?._zynq === 'ACCEPTED') {
                this._registerSession(conn.peer, 'CHAT');
                this._emit('accepted', { id: conn.peer, type: 'CHAT', by: conn.peer });
            } else if (data?._zynq === 'REJECTED') {
                this._emit('rejected', { id: conn.peer, type: 'CHAT', by: conn.peer });
            } else if (data?._zynq === 'PING') {
                conn.send({ _zynq: 'PONG' });
            } else if (data?._zynq !== 'PONG') {
                this._emit('message', { from: conn.peer, data: data });
            }
        });

        // UNIVERSAL DISCONNECT: Fired when peer closes or cancels
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.activeSessions.delete(`${conn.peer}-CHAT`);
            this._emit('disconnected', { id: conn.peer, type: 'CHAT', by: conn.peer });
        });
    }

    _setupMediaHandlers(call, rId) {
        this.calls.set(call.peer, call);
        call.on('stream', (s) => {
            const el = document.getElementById(rId);
            if (el) el.srcObject = s;
            this._registerSession(call.peer, 'VIDEO');
        });

        // UNIVERSAL DISCONNECT: Also for video
        call.on('close', () => {
            this.calls.delete(call.peer);
            this.activeSessions.delete(`${call.peer}-VIDEO`);
            this._emit('disconnected', { id: call.peer, type: 'VIDEO', by: call.peer });
        });
    }

    on(e, cb) { this.events[e] = cb; }
    _emit(e, d) { if (this.events[e]) this.events[e](d); }

    connect(id) { this._setupDataHandlers(this.peer.connect(id)); }
    
    async call(id, lId, rId) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const localEl = document.getElementById(lId);
        if (localEl) localEl.srcObject = s;
        this._setupMediaHandlers(this.peer.call(id, s), rId);
    }

    send(id, msg) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(msg); return true; }
        return false;
    }

    // Manual hang up / cancel
    disconnect(id) {
        const c = this.connections.get(id);
        if (c) c.close();
        const call = this.calls.get(id);
        if (call) call.close();
    }
};
