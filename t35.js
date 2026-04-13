window.ZYNQ = window.ZYNQ || {};
ZYNQ.Peer = class {
    constructor(id = null) {
        this.events = {};
        this.connections = new Map();
        this._init(id || this._generateFriendlyId());
    }

    _generateFriendlyId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
    }

    log(msg) { this._emit('debug', msg); }

    async _init(id) {
        if (!window.Peer) {
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r;
                document.head.appendChild(s);
            });
        }
        this.peer = new Peer(id);
        this.peer.on('open', id => this._emit('ready', id));

        this.peer.on('connection', conn => {
            this._setupDataHandlers(conn);
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    const ok = () => { 
                        conn.send({ _zynq: 'ACCEPTED' }); 
                        this._emit('open', { id: conn.peer, type: 'CHAT' }); 
                    };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => {
                    const deny = () => conn.send({ _zynq: 'REJECTED' });
                    if (conn.open) deny(); else conn.on('open', deny);
                }
            });
        });

        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async (localId, remoteId) => {
                    try {
                        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this._bind(document.getElementById(localId), s);
                        call.answer(s);
                        this._setupMediaHandlers(call, remoteId);
                    } catch (e) { this.log("Media Error: " + e.message); }
                },
                reject: () => call.close()
            });
        });
    }

    _setupDataHandlers(conn) {
        if (this.connections.has(conn.peer)) return;
        this.connections.set(conn.peer, conn);
        
        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') this._emit('open', { id: conn.peer, type: 'CHAT' });
            else if (d?._zynq === 'REJECTED') this._emit('status', `Rejected by ${conn.peer}`);
            else this._emit('message', { from: conn.peer, data: d });
        });
        
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('status', `Disconnected from ${conn.peer}`);
        });
    }

    _setupMediaHandlers(call, remoteId) {
        call.on('stream', s => {
            this._bind(document.getElementById(remoteId), s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });
    }

    _bind(el, s) { 
        if (!el) return;
        el.srcObject = s;
        el.onloadedmetadata = () => el.play().catch(() => {});
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    connect(id) {
        if (this.connections.has(id)) return;
        this.log(`Connecting to ${id}...`);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    async call(id, localId, remoteId) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this._bind(document.getElementById(localId), s);
        const call = this.peer.call(id, s);
        this._setupMediaHandlers(call, remoteId);
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(data); return true; }
        return false;
    }
};
