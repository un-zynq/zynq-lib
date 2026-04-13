/**
 * ZYNQ v18 - Independent UI Sync
 * Beheert Chat en Video als aparte stromen.
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

        // Ontvanger: Chat verzoek
        this.peer.on('connection', conn => {
            this._emit('request', {
                from: conn.peer, type: 'CHAT',
                accept: () => {
                    this.connections.set(conn.peer, conn);
                    this._setupData(conn);
                    conn.on('open', () => {
                        conn.send({ _z: 'ACK_CHAT' }); 
                        this._emit('ui_update', { type: 'CHAT', id: conn.peer });
                    });
                },
                reject: () => { conn.on('open', () => { conn.send({ _z: 'NAK' }); setTimeout(()=>conn.close(), 500); }); }
            });
        });

        // Ontvanger: Video verzoek
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer, type: 'CALL',
                accept: async () => {
                    const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
                    this._bind(this.localVid, s);
                    call.answer(s);
                    this._setupMedia(call);
                    this._emit('ui_update', { type: 'VIDEO', id: call.peer });
                },
                reject: () => call.close()
            });
        });
    }

    _bind(el, s) { if (el) { el.srcObject = s; el.play().catch(e => console.error(e)); } }

    _setupMedia(call) {
        call.on('stream', s => {
            this._bind(this.remoteVid, s);
            this._emit('ui_update', { type: 'VIDEO', id: call.peer });
        });
    }

    _setupData(conn) {
        conn.on('data', d => {
            if (d._z === 'ACK_CHAT') this._emit('ui_update', { type: 'CHAT', id: conn.peer });
            else if (d._z === 'NAK') this._emit('rejected', conn.peer);
            else this._emit('message', { from: conn.peer, data: d });
        });
        conn.on('close', () => { this.connections.delete(conn.peer); this._emit('disconnected', conn.peer); });
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
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c && c.open) { c.send(data); return true; }
        return false;
    }
};
