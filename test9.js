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
            this.peer.on('error', err => { this._emit('error', err); reject(err); });
            
            // Inkomende Data
            this.peer.on('connection', conn => {
                this._isInitiator = false;
                this._setupData(conn);
            });

            // Inkomende Media (Directe Call)
            this.peer.on('call', call => {
                this._emit('request', {
                    from: call.peer,
                    type: 'CALL',
                    accept: async () => {
                        const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
                        call.answer(s);
                        this._setupMedia(call);
                        return s; // Geef lokale stream terug aan dev
                    },
                    reject: () => call.close()
                });
            });
        });
    }

    _setupData(conn) {
        conn.on('open', () => {
            this.connections.set(conn.peer, conn);
            if (!this._isInitiator) this._emit('request', { from: conn.peer, type: 'CHAT' });
        });

        conn.on('data', data => {
            if (data._zynq === 'ACCEPT') this._emit('open', conn.peer);
            else if (data._zynq === 'REJECT') { this._emit('rejected', conn.peer); conn.close(); }
            else this._emit('message', { from: conn.peer, data });
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('close', conn.peer);
        });
    }

    _setupMedia(call) {
        call.on('stream', s => this._emit('stream', { from: call.peer, stream: s }));
    }

    // --- Public Methods ---
    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    async connect(id) {
        this._isInitiator = true;
        await this._initialized;
        const conn = this.peer.connect(id);
        this._setupData(conn);
    }

    accept(id) {
        const conn = this.connections.get(id);
        if (conn) { conn.send({ _zynq: 'ACCEPT' }); this._emit('open', id); }
    }

    reject(id) {
        const conn = this.connections.get(id);
        if (conn) { conn.send({ _zynq: 'REJECT' }); setTimeout(() => conn.close(), 100); }
    }

    send(id, data) {
        const conn = this.connections.get(id);
        if (conn?.open) conn.send(data);
    }

    async call(id) {
        const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
        const call = this.peer.call(id, s);
        this._setupMedia(call);
        return s;
    }
};
