window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.localVideo = document.getElementById(config.localId);
        this.remoteVideo = document.getElementById(config.remoteId);
        this._init(config.id);
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
        this.peer.on('open', id => {
            this.log("PeerJS verbonden met ID: " + id);
            this._emit('ready', id);
        });

        // INKOMENDE CHAT/DATA
        this.peer.on('connection', conn => {
            this.log("Inkomende connectie van: " + conn.peer);
            this._setupDataHandlers(conn);
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.log("Chat geaccepteerd");
                    const ok = () => {
                        conn.send({ _zynq: 'ACCEPTED' });
                        this._emit('open', { id: conn.peer, type: 'CHAT' });
                    };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => {
                    this.log("Chat geweigerd");
                    if (conn.open) conn.send({ _zynq: 'REJECTED' });
                    setTimeout(() => conn.close(), 500);
                }
            });
        });

        // INKOMENDE VIDEO
        this.peer.on('call', call => {
            this.log("Inkomende video-oproep van: " + call.peer);
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async () => {
                    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    this._bind(this.localVideo, s);
                    call.answer(s);
                    this._setupMediaHandlers(call);
                },
                reject: () => call.close()
            });
        });

        this.peer.on('error', err => this.log("PeerJS FOUT: " + err.type));
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') {
                this.log("Partner heeft geaccepteerd!");
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d?._zynq === 'REJECTED') {
                this.log("Partner heeft geweigerd.");
                this._emit('status', "Geweigerd");
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.log("Verbinding met " + conn.peer + " gesloten.");
            this._emit('status', "Offline");
        });
    }

    _setupMediaHandlers(call) {
        call.on('stream', s => {
            this.log("Video stream ontvangen");
            this._bind(this.remoteVideo, s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });
    }

    _bind(el, s) { if (el) { el.srcObject = s; el.play().catch(e => this.log("Video Play Error: " + e)); } }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    connect(id) {
        if (!id) return;
        this.log("Verbinden met " + id + "...");
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    async call(id) {
        if (!id) return;
        this.log("Bellen naar " + id + "...");
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this._bind(this.localVideo, s);
        const call = this.peer.call(id, s);
        this._setupMediaHandlers(call);
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c?.open) {
            c.send(data);
            return true;
        }
        return false;
    }
};
