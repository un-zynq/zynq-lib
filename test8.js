window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.config = { video: false, audio: false, ...config };
        this.peer = null;
        this.connections = new Map();
        this.events = {};
        this._isInitiator = false;
        this._initialized = this._loadAndInit();
    }

    async _loadAndInit() {
        if (!window.Peer) {
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r;
                document.head.appendChild(s);
            });
        }
        return this._init();
    }

    _init() {
        return new Promise((resolve, reject) => {
            this.peer = new Peer(this.config.id);
            this.peer.on('open', id => { resolve(id); this._emit('ready', id); });
            this.peer.on('error', err => { reject(err); this._emit('error', err); });
            this.peer.on('connection', conn => {
                this._isInitiator = false;
                this._handleIncoming(conn);
            });
            this.peer.on('call', call => {
                this._emit('request', {
                    from: call.peer,
                    type: 'media',
                    accept: (stream) => { call.answer(stream); this._setupCall(call); },
                    reject: () => call.close()
                });
            });
        });
    }

    _handleIncoming(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (!this._isInitiator) this._emit('request', { from: conn.peer, type: 'data' });
        });

        conn.on('data', data => {
            if (data._zynq === 'ACCEPT') this._emit('open', conn.peer);
            else if (data._zynq === 'REJECT') { this._emit('rejected', { from: conn.peer }); conn.close(); }
            else this._emit('message', { from: conn.peer, data });
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('close', { id: conn.peer });
        });
    }

    // --- Public DX API ---
    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    async connect(id) {
        await this._initialized;
        this._isInitiator = true;
        const conn = this.peer.connect(id);
        this._handleIncoming(conn);
        return conn;
    }

    accept(id) {
        const conn = this.connections.get(id);
        if (conn) {
            conn.send({ _zynq: 'ACCEPT' });
            this._emit('open', id);
        }
    }

    reject(id) {
        const conn = this.connections.get(id);
        if (conn) {
            conn.send({ _zynq: 'REJECT' });
            setTimeout(() => conn.close(), 100);
        }
    }

    send(id, data) {
        const conn = this.connections.get(id);
        if (conn && conn.open) conn.send(data);
        else console.warn(`ZYNQ: Connection to ${id} is not open.`);
    }

    async call(id, constraints = { video: true, audio: true }) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        const call = this.peer.call(id, stream);
        this._setupCall(call);
        return { call, stream };
    }

    _setupCall(call) {
        call.on('stream', s => this._emit('stream', { from: call.peer, stream: s }));
    }
};
