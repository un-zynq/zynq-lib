window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.localVideo = document.getElementById(config.localId);
        this.remoteVideo = document.getElementById(config.remoteId);
        
        // Genereer hch-hch ID als er geen ID is meegegeven
        const myId = config.id || this._generateFriendlyId();
        this._init(myId);
    }

    _generateFriendlyId() {
        // Vermijd verwarrende of lastige letters
        const chars = "ABCDEFGHJKLMNPRSTUVW"; 
        const nums = "23456789";
        const r = (set) => set[Math.floor(Math.random() * set.length)];
        return `${r(chars)}${r(nums)}${r(chars)}-${r(chars)}${r(nums)}${r(chars)}`;
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
            this.log(`Systeem Online. Mijn ID: ${id}`);
            this._emit('ready', id);
        });

        this.peer.on('connection', conn => {
            this.log(`Inkomend verzoek van [${conn.peer}]`);
            this._setupDataHandlers(conn);
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.log(`Chat geaccepteerd met [${conn.peer}]`);
                    const ok = () => { 
                        conn.send({ _zynq: 'ACCEPTED', meta: { time: Date.now() } }); 
                        this._emit('open', { id: conn.peer, type: 'CHAT' }); 
                    };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => {
                    this.log(`Chat geweigerd voor [${conn.peer}]`);
                    if (conn.open) conn.send({ _zynq: 'REJECTED' });
                    setTimeout(() => conn.close(), 500);
                }
            });
        });

        this.peer.on('call', call => {
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

        this.peer.on('error', err => {
            if (err.type === 'unavailable-id') {
                this.log("FOUT: ID is al bezet! Kies een ander of herlaad.");
            } else {
                this.log("PeerJS FOUT: " + err.type);
            }
        });
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') {
                this.log(`[ACCEPTED] Verbinding bevestigd door ${conn.peer}`);
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d?._zynq === 'REJECTED') {
                this.log(`[REJECTED] Verzoek geweigerd door ${conn.peer}`);
                this._emit('status', `Geweigerd door ${conn.peer}`);
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        conn.on('close', () => {
            this.log(`[DISCONNECTED] Partner ${conn.peer} is weg.`);
            this.connections.delete(conn.peer);
            this._emit('status', "Verbinding verbroken");
        });
    }

    _setupMediaHandlers(call) {
        call.on('stream', s => {
            this.log(`Video stream ontvangen van [${call.peer}]`);
            this._bind(this.remoteVideo, s);
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
        if (!id) return this.log("Vul eerst een ID in.");
        this.log(`Verzoek sturen naar [${id}]...`);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    async call(id) {
        if (!id) return;
        try {
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this._bind(this.localVideo, s);
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call);
        } catch (e) { this.log("Camera FOUT: " + e.message); }
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(data); return true; }
        return false;
    }
};
