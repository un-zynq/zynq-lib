window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.localVideo = document.getElementById(config.localId);
        this.remoteVideo = document.getElementById(config.remoteId);
        this._init(config.id);
    }

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

        // CRUCIAL: Luister ALTIJD naar inkomende data-kanalen
        this.peer.on('connection', conn => {
            this._registerConnection(conn);
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
                    if (conn.open) conn.send({ _zynq: 'REJECTED' });
                    setTimeout(() => conn.close(), 500);
                }
            });
        });

        // CRUCIAL: Luister ALTIJD naar inkomende video-oproepen
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
                    } catch (e) { console.error(e); }
                },
                reject: () => call.close()
            });
        });
    }

    _registerConnection(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('data', d => {
            if (d && d._zynq === 'ACCEPTED') {
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d && d._zynq === 'REJECTED') {
                this._emit('status', "Geweigerd");
                this.connections.delete(conn.peer);
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('status', "Offline");
        });
    }

    _bind(el, s) { if (el) { el.srcObject = s; el.play().catch(e => {}); } }

    _setupMedia(call) {
        call.on('stream', s => {
            this._bind(this.remoteVideo, s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    connect(id) {
        if (!id || id === this.peer.id) return;
        this._emit('status', "Aanvragen...");
        const conn = this.peer.connect(id);
        this._registerConnection(conn);
    }

    async call(id) {
        if (!id || id === this.peer.id) return;
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
