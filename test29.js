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

        // LUISTEREN NAAR INKOMENDE CHAT (Voor beide partijen)
        this.peer.on('connection', conn => {
            this._setupData(conn);
            this.connections.set(conn.peer, conn);

            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    const confirm = () => {
                        conn.send({ _zynq: 'ACCEPTED' });
                        this._emit('open', { id: conn.peer, type: 'CHAT' });
                    };
                    if (conn.open) confirm(); else conn.on('open', confirm);
                },
                reject: () => {
                    const deny = () => {
                        conn.send({ _zynq: 'REJECTED' });
                        setTimeout(() => conn.close(), 500);
                    };
                    if (conn.open) deny(); else conn.on('open', deny);
                }
            });
        });

        // LUISTEREN NAAR INKOMENDE VIDEO (Voor beide partijen)
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async () => {
                    try {
                        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this._bind(this.localVideo, s);
                        call.answer(s);
                        this._setupMedia(call);
                    } catch (e) { alert("Camera error: " + e.message); }
                },
                reject: () => call.close()
            });
        });
    }

    _bind(el, s) { if (el) { el.srcObject = s; el.play().catch(() => {}); } }

    _setupMedia(call) {
        call.on('stream', s => {
            this._bind(this.remoteVideo, s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });
    }

    _setupData(conn) {
        conn.on('data', d => {
            if (d && d._zynq === 'ACCEPTED') {
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d && d._zynq === 'REJECTED') {
                this._emit('status', "Geweigerd door partner");
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('status', "Verbinding verbroken");
        });
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    // ZELF BELLEN
    connect(id) {
        if (!id) return;
        const conn = this.peer.connect(id);
        this.connections.set(id, conn);
        this._setupData(conn);
        this._emit('status', "Aanvragen...");
    }

    async call(id) {
        if (!id) return;
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this._bind(this.localVideo, s);
        const call = this.peer.call(id, s);
        this._setupMedia(call);
        this._emit('status', "Bellen...");
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
