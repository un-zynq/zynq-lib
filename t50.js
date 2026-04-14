/** * ZYNQ CORE LIBRARY v1.4.2 
 * Inline & Optimized for Connection Stability
 */
window.ZYNQ = window.ZYNQ || {};
ZYNQ.Peer = class {
    constructor() {
        this.events = {};
        this.connections = new Map(); 
        this.calls = new Map();        
        this.activeSessions = new Set();
        this._emittedStates = new Set();
        this.myId = null;
        this._init();
    }

    _generateId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
    }

    _init() {
        this.peer = new Peer(this._generateId());
        this.peer.on('open', id => { this.myId = id; this._emit('ready', id); });
        
        this.peer.on('connection', conn => {
            conn.on('data', data => {
                if (data?._zynq === 'CHECK_ONLINE') {
                    conn.send({ _zynq: 'PONG_ONLINE' });
                    setTimeout(() => conn.close(), 500);
                    return;
                }
                this._handleData(conn, data);
            });

            // Handshake logic: Wacht even of het een online check is
            setTimeout(() => {
                if (conn.open && !this.activeSessions.has(`${conn.peer}-CHAT`) && !conn.isSilent) {
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
                            setTimeout(() => conn.close(), 100);
                        }
                    });
                }
            }, 600);
        });

        this.peer.on('call', call => {
            this._emit('incoming', {
                from: call.peer, type: 'VIDEO',
                accept: async (lId, rId) => {
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    this._handleStream(s, lId, 'local', 'LOCAL');
                    call.answer(s);
                    this._setupMediaHandlers(call, rId);
                    this._emit('accepted', { id: call.peer, type: 'VIDEO' });
                },
                reject: () => call.close()
            });
        });
    }

    _handleData(conn, data) {
        if (!data?._zynq) return this._emit('message', { from: conn.peer, data: data });
        if (data._zynq === 'ACCEPTED') {
            this._registerSession(conn.peer, data._type);
            this._emit('accepted', { id: conn.peer, type: data._type });
        } else if (data._zynq === 'REJECTED') {
            this._emit('rejected', { id: conn.peer, type: data._type });
        }
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.activeSessions.delete(`${conn.peer}-CHAT`);
            this._emit('disconnected', { id: conn.peer, type: 'CHAT' });
        });
    }

    _setupMediaHandlers(call, rId) {
        this.calls.set(call.peer, call);
        call.on('stream', s => this._handleStream(s, rId, call.peer, 'REMOTE'));
        call.on('close', () => {
            this.calls.delete(call.peer);
            this.activeSessions.delete(`${call.peer}-VIDEO`);
            this._emit('disconnected', { id: call.peer, type: 'VIDEO' });
        });
    }

    _handleStream(s, eId, pId, type) {
        if (eId && document.getElementById(eId)) document.getElementById(eId).srcObject = s;
        this._emit('stream', { id: pId, type: type, stream: s });
    }

    _emit(e, d) {
        const key = e === 'message' ? null : `${e}-${d?.id || d}-${d?.type || ''}`;
        if (key && this._emittedStates.has(key)) return;
        if (key) { this._emittedStates.add(key); setTimeout(() => this._emittedStates.delete(key), 2000); }
        if (this.events[e]) this.events[e](d);
    }

    on(e, cb) { this.events[e] = cb; }
    _registerSession(id, type) { this.activeSessions.add(`${id}-${type}`); }

    isOnline(id) {
        return new Promise(resolve => {
            const conn = this.peer.connect(id, { reliable: true });
            let found = false;
            const timer = setTimeout(() => { if(!found) { conn.close(); resolve(false); } }, 4000);
            conn.on('open', () => conn.send({ _zynq: 'CHECK_ONLINE' }));
            conn.on('data', d => { if(d?._zynq === 'PONG_ONLINE') { found=true; clearTimeout(timer); conn.close(); resolve(true); }});
            conn.on('error', () => { found=true; clearTimeout(timer); resolve(false); });
        });
    }

    connect(id) {
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
        conn.on('data', d => this._handleData(conn, d));
    }

    send(id, msg) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(msg); return true; }
        return false;
    }

    call(id, lId, rId) {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(s => {
            this._handleStream(s, lId, 'local', 'LOCAL');
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call, rId);
        });
    }

    disconnect(id) {
        if (this.connections.has(id)) this.connections.get(id).close();
        if (this.calls.has(id)) this.calls.get(id).close();
    }
};
