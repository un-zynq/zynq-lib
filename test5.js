window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.config = { video: config.video || false, audio: config.audio || false, id: config.id || null };
        this.peer = null;
        this.connections = new Map();
        this.events = {};
        this._loadPeerJS().then(() => this._init());
    }

    async _loadPeerJS() {
        if (window.Peer) return;
        return new Promise(r => {
            const s = document.createElement('script');
            s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
            s.onload = r;
            document.head.appendChild(s);
        });
    }

    _init() {
        this.peer = new Peer(this.config.id);
        this.peer.on('open', id => this._emit('ready', id));
        this.peer.on('connection', conn => this._handleIncoming(conn));
        this.peer.on('call', call => {
            // Media request trigger
            this._emit('request', { 
                from: call.peer, 
                type: 'media', 
                accept: (stream) => { call.answer(stream); this._setupCall(call); },
                reject: () => call.close()
            });
        });
    }

    _handleIncoming(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            // Alleen de ontvanger krijgt de 'request' event
            this._emit('request', { from: conn.peer, type: 'data' });
        });

        conn.on('data', data => {
            if (data._zynq === 'ACCEPT') {
                this._emit('open', conn.peer); // Nu pas mag de zender de UI zien
            } else if (data._zynq === 'REJECT') {
                this._emit('rejected', conn.peer);
                conn.close();
            } else {
                this._emit('message', { from: conn.peer, data });
            }
        });
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    connect(id) {
        const conn = this.peer.connect(id);
        this._handleIncoming(conn);
    }

    accept(id) {
        const conn = this.connections.get(id);
        if (conn) {
            conn.send({ _zynq: 'ACCEPT' });
            this._emit('open', id); // Open direct bij ontvanger
        }
    }

    reject(id) {
        const conn = this.connections.get(id);
        if (conn) { conn.send({ _zynq: 'REJECT' }); conn.close(); }
    }

    send(id, data) {
        const conn = this.connections.get(id);
        if (conn) conn.send(data);
    }

    call(id, stream) {
        const call = this.peer.call(id, stream);
        this._setupCall(call);
    }

    _setupCall(call) {
        call.on('stream', s => this._emit('stream', { from: call.peer, stream: s }));
    }
};
