window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.peer = null;
        this.connections = new Map();
        this.events = {};
        this._isInitiator = false;
        this._loadAndInit(config.id);
    }

    async _loadAndInit(id) {
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
            this._isInitiator = false; 
            this._handleIncomingData(conn); 
        });
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'CALL',
                accept: async () => {
                    const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
                    call.answer(s);
                    this._setupMedia(call);
                    return s;
                },
                reject: () => call.close()
            });
        });
    }

    _handleIncomingData(conn) {
        this._emit('request', {
            from: conn.peer,
            type: 'CONNECT',
            accept: () => {
                this.connections.set(conn.peer, conn);
                this._setupDataEvents(conn);
                conn.on('open', () => {
                    conn.send({ _zynq: 'ACCEPTED' });
                    this._emit('open', conn.peer);
                });
            },
            reject: () => {
                conn.on('open', () => {
                    conn.send({ _zynq: 'REJECTED' });
                    setTimeout(() => conn.close(), 500);
                });
            }
        });
    }

    _setupDataEvents(conn) {
        conn.on('data', data => {
            if (data._zynq === 'ACCEPTED') this._emit('open', conn.peer);
            else if (data._zynq === 'REJECTED') this._emit('rejected', conn.peer);
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

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    connect(id) {
        this._isInitiator = true;
        const conn = this.peer.connect(id);
        this.connections.set(id, conn);
        this._setupDataEvents(conn);
    }

    async call(id) {
        const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
        const call = this.peer.call(id, s);
        this._setupMedia(call);
        return s;
    }

    send(id, data) {
        const conn = this.connections.get(id);
        if (conn && conn.open) conn.send(data);
    }
};
