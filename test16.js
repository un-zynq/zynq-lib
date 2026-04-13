/**
 * ZYNQ v16 - Ultra Sync (Chat & Video)
 * Fixes: Single-sided UI opening and stream binding delays.
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.localVid = document.getElementById(config.localId);
        this.remoteVid = document.getElementById(config.remoteId);
        this._init(config.id);
    }

    async _init(id) {
        if (!window.Peer) {
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r; document.head.appendChild(s);
            });
        }
        this.peer = new Peer(id);
        this.peer.on('open', i => this._emit('ready', i));
        this.peer.on('error', e => this._emit('error', e));

        // Persistent Chat Handshake
        this.peer.on('connection', conn => {
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.connections.set(conn.peer, conn);
                    this._setupData(conn);
                    conn.on('open', () => {
                        conn.send({ _z: 'ACK_CHAT' });
                        this._emit('connected', { id: conn.peer, type: 'CHAT' });
                    });
                },
                reject: () => {
                    conn.on('open', () => {
                        conn.send({ _z: 'NAK' });
                        setTimeout(() => conn.close(), 500);
                    });
                }
            });
        });

        // On-Demand Call Handshake
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'CALL',
                accept: async () => {
                    const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
                    this._bind(this.localVid, s);
                    call.answer(s);
                    this._setupMedia(call);
                    // Signal back that we accepted
                    this._emit('connected', { id: call.peer, type: 'CALL' });
                },
                reject: () => call.close()
            });
        });
    }

    _bind(el, s) {
        if (el) {
            el.srcObject = s;
            el.onloadedmetadata = () => el.play().catch(e => console.error("Autoplay blocked:", e));
        }
    }

    _setupMedia(call) {
        call.on('stream', s => {
            this._bind(this.remoteVid, s);
            // Trigger connected for the initiator when stream arrives
            this._emit('connected', { id: call.peer, type: 'CALL' });
        });
    }

    _setupData(conn) {
        conn.on('data', d => {
            if (d._z === 'ACK_CHAT') this._emit('connected', { id: conn.peer, type: 'CHAT' });
            else if (d._z === 'NAK') this._emit('rejected', conn.peer);
            else this._emit('message', { from: conn.peer, data: d });
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('disconnected', conn.peer);
        });
    }

    on(e, b) { this.events[e] = b; }
    _emit(e, d) { if (this.events[e]) this.events[e](d); }

    connect(id) {
        const conn = this.peer.connect(id);
        this.connections.set(id, conn);
        this._setupData(conn);
    }

    async call(id) {
        const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
        this._bind(this.localVid, s);
        const call = this.peer.call(id, s);
        this._setupMedia(call);
        // Initiator UI will open via _setupMedia 'stream' event to ensure sync
    }

    send(id, data) {
        const conn = this.connections.get(id);
        if (conn && conn.open) {
            conn.send(data);
            return true;
        }
        return false;
    }
};
