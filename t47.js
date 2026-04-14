/**
 * ZYNQ Core Library - Version: 1.4.0 (T47)
 * Fixed: Double message emission & Improved Silent Handshake
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
        this.peer.on('open', assignedId => {
            this.myId = assignedId;
            this._emit('ready', assignedId);
        });

        // Incoming Connection Handler
        this.peer.on('connection', conn => {
            conn.on('data', data => {
                // Silent Check afhandeling
                if (data?._zynq === 'CHECK_ONLINE') {
                    conn.send({ _zynq: 'PONG_ONLINE' });
                    setTimeout(() => conn.close(), 100);
                    return;
                }
                // Als het geen check is, verwerk data
                this._handleData(conn, data);
            });

            // Delay om te zien of het een silent check is
            const handshakeTimeout = setTimeout(() => {
                if (!conn.isSilent) {
                    this._setupDataHandlers(conn);
                    this._emit('incoming', { 
                        from: conn.peer, type: 'CHAT',
                        accept: () => {
                            conn.send({ _zynq: 'ACCEPTED' });
                            this._registerSession(conn.peer, 'CHAT');
                            this._emit('accepted', { id: conn.peer, type: 'CHAT' });
                        },
                        reject: () => {
                            conn.send({ _zynq: 'REJECTED' });
                            setTimeout(() => conn.close(), 100);
                        }
                    });
                }
            }, 200);

            conn.on('data', d => { if(d?._zynq === 'CHECK_ONLINE') conn.isSilent = true; });
        });

        this.peer.on('call', call => {
            this._emit('incoming', {
                from: call.peer, type: 'VIDEO',
                accept: async (lId, rId) => {
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    if (lId && document.getElementById(lId)) document.getElementById(lId).srcObject = s;
                    this._emit('stream', { id: 'local', type: 'LOCAL', stream: s });
                    call.answer(s);
                    this._setupMediaHandlers(call, rId);
                    this._emit('accepted', { id: call.peer, type: 'VIDEO' });
                },
                reject: () => call.close()
            });
        });
    }

    isOnline(id) {
        return new Promise(resolve => {
            const conn = this.peer.connect(id, { reliable: true });
            let done = false;
            const t = setTimeout(() => { if(!done){ conn.close(); resolve(false); } }, 3500);
            conn.on('open', () => conn.send({ _zynq: 'CHECK_ONLINE' }));
            conn.on('data', d => {
                if(d?._zynq === 'PONG_ONLINE'){ done=true; clearTimeout(t); conn.close(); resolve(true); }
            });
            conn.on('error', () => { done=true; clearTimeout(t); resolve(false); });
        });
    }

    _handleData(conn, data) {
        if (data?._zynq === 'ACCEPTED') {
            this._registerSession(conn.peer, 'CHAT');
            this._emit('accepted', { id: conn.peer, type: 'CHAT' });
        } else if (data?._zynq === 'REJECTED') {
            this._emit('rejected', { id: conn.peer });
        } else if (data && typeof data !== 'object' || !data._zynq) {
            // ALLEEN emitten als het geen intern systeembericht is
            this._emit('message', { from: conn.peer, data: data });
        }
    }

    _setupDataHandlers(conn) {
        if (this.connections.has(conn.peer)) return;
        this.connections.set(conn.peer, conn);
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('disconnected', { id: conn.peer });
        });
    }

    _setupMediaHandlers(call, rId) {
        this.calls.set(call.peer, call);
        call.on('stream', s => {
            if (rId && document.getElementById(rId)) document.getElementById(rId).srcObject = s;
            this._emit('stream', { id: call.peer, type: 'REMOTE', stream: s });
        });
        call.on('close', () => {
            this.calls.delete(call.peer);
            this._emit('disconnected', { id: call.peer });
        });
    }

    _registerSession(id, type) { this.activeSessions.add(`${id}-${type}`); }
    on(e, cb) { this.events[e] = cb; }
    _emit(e, d) { if (this.events[e]) this.events[e](d); }

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
            if (lId && document.getElementById(lId)) document.getElementById(lId).srcObject = s;
            this._emit('stream', { id: 'local', type: 'LOCAL', stream: s });
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call, rId);
        });
    }

    disconnect(id) {
        const c = this.connections.get(id); if (c) c.close();
        const call = this.calls.get(id); if (call) call.close();
    }
};
