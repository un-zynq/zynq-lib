/**
 * ZYNQ v18 - Connection Fix
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
        this.peer.on('error', e => this._emit('status', "Peer Error: " + e.type));

        // Ontvanger kant: Chat verzoek
        this.peer.on('connection', conn => {
            this._emit('request', {
                from: conn.peer, type: 'CHAT',
                accept: () => {
                    this.connections.set(conn.peer, conn);
                    this._setupData(conn);
                    // Belangrijk: wacht tot de connectie echt open is voor we ACK sturen
                    conn.on('open', () => {
                        conn.send({ _z: 'ACK_CHAT' }); 
                        this._emit('status', "Chat connected with " + conn.peer);
                        this._emit('ui_update', { type: 'CHAT', id: conn.peer });
                    });
                },
                reject: () => {
                    conn.on('open', () => {
                        conn.send({ _z: 'REJECTED' });
                        setTimeout(() => conn.close(), 500);
                    });
                }
            });
        });

        // Ontvanger kant: Video verzoek
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer, type: 'CALL',
                accept: async () => {
                    const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
                    this._bind(this.localVid, s);
                    call.answer(s);
                    this._setupMedia(call);
                    this._emit('status', "Video call accepted");
                },
                reject: () => call.close()
            });
        });
    }

    _bind(el, s) { if (el) el.srcObject = s; }

    _setupMedia(call) {
        call.on('stream', s => {
            this._bind(this.remoteVid, s);
            this._emit('ui_update', { type: 'VIDEO', id: call.peer });
            this._emit('status', "Video stream active");
        });
    }

    _setupData(conn) {
        // Luister naar data (vooral voor de beller om de ACK te ontvangen)
        conn.on('data', d => {
            if (d._z === 'ACK_CHAT') {
                this._emit('status', "Partner accepted chat");
                this._emit('ui_update', { type: 'CHAT', id: conn.peer });
            } else if (d._z === 'REJECTED') {
                this._emit('status', "Partner rejected chat");
                conn.close();
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });

        conn.on('close', () => {
            this._emit('status', "Connection closed");
            this.connections.delete(conn.peer);
        });
    }

    on(e, b) { this.events[e] = b; }
    _emit(e, d) { if (this.events[e]) this.events[e](d); }

    connect(id) {
        this._emit('status', "Sending chat request...");
        const conn = this.peer.connect(id);
        this.connections.set(id, conn);
        this._setupData(conn);
    }

    async call(id) {
        this._emit('status', "Calling partner...");
        try {
            const s = await navigator.mediaDevices.getUserMedia({video:true, audio:true});
            this._bind(this.localVid, s);
            const call = this.peer.call(id, s);
            this._setupMedia(call);
        } catch (err) {
            this._emit('status', "Camera error: " + err.message);
        }
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
