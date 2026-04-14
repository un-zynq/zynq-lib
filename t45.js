/**
 * ZYNQ Core Library
 * Version: 1.3.0
 * Flexible Stream Handling & Optional UI Binding + Online Status Check.
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
            conn.on('data', (data) => {
                // Silent check: als het een online-check is, negeer het 'incoming' event
                if (data?._zynq === 'CHECK_ONLINE') {
                    conn.send({ _zynq: 'PONG_ONLINE' });
                    setTimeout(() => conn.close(), 50);
                    return;
                }
                
                // Normale data afhandeling
                this._handleData(conn, data);
            });

            // Alleen een 'incoming' event triggeren als het GEEN silent check is
            // We wachten heel even om te zien of het eerste bericht een check is
            const checkTimeout = setTimeout(() => {
                if (!conn.isSilentCheck) {
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
                }
            }, 150);

            conn.on('data', (data) => {
                if (data?._zynq === 'CHECK_ONLINE') {
                    conn.isSilentCheck = true;
                    clearTimeout(checkTimeout);
                }
            });
        });

        this.peer.on('call', (call) => {
            this._emit('incoming', {
                from: call.peer, type: 'VIDEO',
                accept: async (lId = null, rId = null) => {
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    if (lId) {
                        const localEl = document.getElementById(lId);
                        if (localEl) localEl.srcObject = s;
                    }
                    this._emit('stream', { id: 'local', type: 'LOCAL', stream: s });
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

    /**
     * Controleert of een ID online is zonder UI te storen.
     */
    isOnline(id) {
        return new Promise((resolve) => {
            const conn = this.peer.connect(id, { reliable: true });
            let resolved = false;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    conn.close();
                    resolve(false);
                }
            }, 3000);

            conn.on('open', () => {
                conn.send({ _zynq: 'CHECK_ONLINE' });
            });

            conn.on('data', (data) => {
                if (data?._zynq === 'PONG_ONLINE') {
                    resolved = true;
                    clearTimeout(timeout);
                    conn.close();
                    resolve(true);
                }
            });

            conn.on('error', () => {
                resolved = true;
                clearTimeout(timeout);
                resolve(false);
            });
        });
    }

    _registerSession(id, type) {
        const key = `${id}-${type}`;
        if (this.activeSessions.has(key)) return;
        this.activeSessions.add(key);
        this._emit('session_start', { id, type });
    }

    _handleData(conn, data) {
        if (data?._zynq === 'ACCEPTED') {
            this._registerSession(conn.peer, 'CHAT');
            this._emit('accepted', { id: conn.peer, type: 'CHAT', by: conn.peer });
        } else if (data?._zynq === 'REJECTED') {
            this._emit('rejected', { id: conn.peer, type: 'CHAT', by: conn.peer });
        } else if (data?._zynq === 'PING') {
            conn.send({ _zynq: 'PONG' });
        } else if (data?._zynq !== 'PONG' && data?._zynq !== 'PONG_ONLINE') {
            this._emit('message', { from: conn.peer, data: data });
        }
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('data', (data) => this._handleData(conn, data));
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.activeSessions.delete(`${conn.peer}-CHAT`);
            this._emit('disconnected', { id: conn.peer, type: 'CHAT', by: conn.peer });
        });
    }

    _setupMediaHandlers(call, rId = null) {
        this.calls.set(call.peer, call);
        call.on('stream', (s) => {
            if (rId) {
                const el = document.getElementById(rId);
                if (el) el.srcObject = s;
            }
            this._emit('stream', { id: call.peer, type: 'REMOTE', stream: s });
            this._registerSession(call.peer, 'VIDEO');
        });

        call.on('close', () => {
            this.calls.delete(call.peer);
            this.activeSessions.delete(`${call.peer}-VIDEO`);
            this._emit('disconnected', { id: call.peer, type: 'VIDEO', by: call.peer });
        });
    }

    on(e, cb) { this.events[e] = cb; }
    _emit(e, d) { if (this.events[e]) this.events[e](d); }

    connect(id) { 
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn); 
    }
    
    async call(id, lId = null, rId = null) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (lId) {
            const localEl = document.getElementById(lId);
            if (localEl) localEl.srcObject = s;
        }
        this._emit('stream', { id: 'local', type: 'LOCAL', stream: s });
        const call = this.peer.call(id, s);
        this._setupMediaHandlers(call, rId);
    }

    send(id, msg) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(msg); return true; }
        return false;
    }

    disconnect(id) {
        const c = this.connections.get(id);
        if (c) c.close();
        const call = this.calls.get(id);
        if (call) call.close();
    }
};
