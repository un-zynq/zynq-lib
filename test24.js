window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.localVideo = document.getElementById(config.localId);
        this.remoteVideo = document.getElementById(config.remoteId);
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

        // Ontvanger kant
        this.peer.on('connection', conn => {
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.connections.set(conn.peer, conn);
                    conn.on('open', () => {
                        this._setupData(conn);
                        conn.send({ _zynq: 'ACCEPTED' }); 
                        this._emit('open', { id: conn.peer, type: 'CHAT' });
                    });
                },
                reject: () => {
                    conn.on('open', () => {
                        conn.send({ _zynq: 'REJECTED' });
                        setTimeout(() => conn.close(), 500);
                    });
                }
            });
        });

        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async () => {
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    this._bind(this.localVideo, s);
                    call.answer(s);
                    this._setupMedia(call);
                },
                reject: () => call.close()
            });
        });
    }

    _bind(el, s) { if (el) { el.srcObject = s; el.play().catch(console.error); } }

    _setupMedia(call) {
        call.on('stream', s => {
            this._bind(this.remoteVideo, s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });
    }

    _setupData(conn) {
        conn.on('data', d => {
            if (d._zynq === 'ACCEPTED') {
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d._zynq === 'REJECTED') {
                this._emit('status', "Geweigerd");
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    connect(id) {
        this._emit('status', "Aanvragen...");
        const conn = this.peer.connect(id);
        this.connections.set(id, conn);
        this._setupData(conn);
        
        // Forceer check als de browser het 'open' event mist
        let checkOpen = setInterval(() => {
            if (conn.open) {
                this._emit('status', "Verbinding open (forced)");
                clearInterval(checkOpen);
            }
        }, 1000);
    }

    async call(id) {
        this._emit('status', "Bellen...");
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this._bind(this.localVideo, s);
        const call = this.peer.call(id, s);
        this._setupMedia(call);
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c && c.open) {
            c.send(data);
            return true;
        }
        return false;
    }
};
