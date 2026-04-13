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
            this.log("PeerJS Online: " + id);
            this._emit('ready', id);
        });

        this.peer.on('connection', conn => {
            this.log("Inkomend CHAT verzoek van: " + conn.peer);
            this._setupDataHandlers(conn);
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    const ok = () => { conn.send({ _zynq: 'ACCEPTED' }); this._emit('open', { id: conn.peer, type: 'CHAT' }); };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => { if (conn.open) conn.send({ _zynq: 'REJECTED' }); setTimeout(() => conn.close(), 500); }
            });
        });

        this.peer.on('call', call => {
            this.log("Inkomend VIDEO verzoek van: " + call.peer);
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async () => {
                    try {
                        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this._bind(this.localVideo, s);
                        call.answer(s);
                        this._setupMediaHandlers(call);
                    } catch (e) { this.log("Camera Fout: " + e.message); }
                },
                reject: () => call.close()
            });
        });

        this.peer.on('error', err => this.log("PeerJS FOUT: " + err.type));
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') this._emit('open', { id: conn.peer, type: 'CHAT' });
            else if (d?._zynq === 'REJECTED') this._emit('status', "Geweigerd");
            else this._emit('message', { from: conn.peer, data: d });
        });
        conn.on('close', () => { this.connections.delete(conn.peer); this._emit('status', "Offline"); });
    }

    _setupMediaHandlers(call) {
        call.on('stream', s => {
            this.log("Stream ontvangen van: " + call.peer);
            this._bind(this.remoteVideo, s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });
    }

    _bind(el, s) { 
        if (!el) return;
        el.srcObject = s;
        el.onloadedmetadata = () => {
            el.play().catch(e => {
                if (e.name !== "AbortError") this.log("Play Error: " + e.name);
            });
        };
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    // Uitgaand
    connect(id) {
        if (!id) return this.log("FOUT: Geen ID ingevuld");
        this.log("Poging verbinden met: " + id);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    async call(id) {
        this.log("Video-knop ingedrukt voor ID: " + id);
        if (!id) return this.log("FOUT: Geen ID voor video");
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.log("Camera toegang verkregen, bellen...");
            this._bind(this.localVideo, s);
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call);
        } catch (e) {
            this.log("Camera FOUT: " + e.message);
        }
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(data); return true; }
        return false;
    }
};
