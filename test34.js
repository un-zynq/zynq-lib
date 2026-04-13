window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
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
                    this.log(`[REJECT] Je hebt het verzoek van ${conn.peer} geweigerd.`);
                    const deny = () => {
                        conn.send({ _zynq: 'REJECTED' });
                        // We sluiten de verbinding NIET direct, om de 'disconnected' loop te voorkomen
                    };
                    if (conn.open) deny(); else conn.on('open', deny);
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
                reject: () => {
                    this.log(`Video oproep van ${call.peer} geweigerd.`);
                    call.close();
                }
            });
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
                // Geen geforceerde close hier
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        
        conn.on('close', () => {
            this.log(`[DISCONNECTED] Partner ${conn.peer} is de verbinding verloren.`);
            this.connections.delete(conn.peer);
            this._emit('status', "Verbinding verbroken");
        });
    }

    _setupMediaHandlers(call) {
        call.on('stream', s => {
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
        if (!id) return;
        this.log(`Verzoek sturen naar [${id}]...`);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    async call(id) {
        if (!id) return;
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this._bind(this.localVideo, s);
        const call = this.peer.call(id, s);
        this._setupMediaHandlers(call);
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(data); return true; }
        return false;
    }
};
