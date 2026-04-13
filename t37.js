window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.activeCalls = new Map();
        this.localVideo = document.getElementById(config.localId);
        this.remoteVideo = document.getElementById(config.remoteId);
        this._init(config.id || this._generateFriendlyId());
    }

    _generateFriendlyId() {
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
            this.log(`Systeem Online. ID: ${id}`);
            this._emit('ready', id);
        });

        // Inkomende Data/Chat verbinding
        this.peer.on('connection', conn => {
            this._setupDataHandlers(conn);
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.log(`Chat geaccepteerd met [${conn.peer}]`);
                    const ok = () => { 
                        conn.send({ _zynq: 'ACCEPTED' }); 
                        this._emit('open', { id: conn.peer, type: 'CHAT' }); 
                    };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => {
                    this.log(`[REJECT] Verzoek van ${conn.peer} geweigerd.`);
                    const deny = () => { conn.send({ _zynq: 'REJECTED' }); };
                    if (conn.open) deny(); else conn.on('open', deny);
                }
            });
        });

        // Inkomende Video oproep
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
                    } catch (e) { 
                        this.log("Camera Fout: " + e.message); 
                    }
                },
                reject: () => {
                    this.log(`Video oproep van ${call.peer} geweigerd.`);
                    call.close();
                }
            });
        });

        this.peer.on('error', err => {
            this.log(`PeerJS Fout: ${err.type}`);
            this._emit('error', err);
        });
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);
        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') {
                this.log(`[ACCEPTED] ${conn.peer} heeft geaccepteerd.`);
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d?._zynq === 'REJECTED') {
                this.log(`[REJECTED] ${conn.peer} heeft je verzoek afgewezen.`);
                this._emit('status', `Geweigerd door ${conn.peer}`);
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        
        conn.on('close', () => {
            this.log(`[DISCONNECTED] Partner ${conn.peer} verbinding verbroken.`);
            this.connections.delete(conn.peer);
            this._emit('status', "Verbinding verbroken");
        });
    }

    _setupMediaHandlers(call) {
        this.activeCalls.set(call.peer, call);
        call.on('stream', s => {
            this.log(`Streaming media van ${call.peer}`);
            this._bind(this.remoteVideo, s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });

        call.on('close', () => {
            this.log(`Video gesprek met ${call.peer} beëindigd.`);
            this.activeCalls.delete(call.peer);
            if (this.remoteVideo) this.remoteVideo.srcObject = null;
        });
    }

    _bind(el, s) { 
        if (!el) return;
        el.srcObject = s;
        el.setAttribute('autoplay', '');
        el.setAttribute('playsinline', '');
        el.onloadedmetadata = () => el.play().catch(e => console.error("Playback error:", e));
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    // Start een chat verbinding
    connect(id) {
        if (!id || id === this.peer.id) return;
        this.log(`Chat-verzoek sturen naar [${id}]...`);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    // Start een video verbinding (Beide kanten kunnen dit aanroepen)
    async call(id) {
        if (!id || id === this.peer.id) return;
        try {
            this.log(`Video oproep starten naar [${id}]...`);
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this._bind(this.localVideo, s);
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call);
        } catch (e) {
            this.log("Media Toegang Geweigerd: " + e.message);
        }
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c?.open) { 
            c.send(data); 
            return true; 
        }
        return false;
    }

    hangup() {
        this.activeCalls.forEach(call => call.close());
        if (this.localVideo && this.localVideo.srcObject) {
            this.localVideo.srcObject.getTracks().forEach(track => track.stop());
            this.localVideo.srcObject = null;
        }
    }
};
