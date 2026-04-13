window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(id = null) {
        this.events = {};
        this.connections = new Map();
        this.peer = null;
        this._init(id || this._generateFriendlyId());
    }

    _generateFriendlyId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
    }

    log(msg) { 
        console.log(`[ZYNQ DEBUG] ${msg}`);
        this._emit('debug', msg); 
    }

    async _init(id) {
        this.log(`Initializing system with ID: ${id}`);
        
        if (!window.Peer) {
            this.log("PeerJS not found, loading dependency...");
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r;
                document.head.appendChild(s);
            });
        }

        this.peer = new Peer(id);

        this.peer.on('open', id => {
            this.log(`PeerServer connection established. Global ID: ${id}`);
            this._emit('ready', id);
        });

        this.peer.on('connection', conn => {
            this.log(`Incoming data connection request from: ${conn.peer}`);
            this._setupDataHandlers(conn);
            
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.log(`Manually accepting CHAT request from ${conn.peer}`);
                    const ok = () => { 
                        conn.send({ _zynq: 'ACCEPTED' }); 
                        this._emit('accepted', { id: conn.peer, type: 'CHAT' });
                        this._emit('open', { id: conn.peer, type: 'CHAT' }); 
                    };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => {
                    this.log(`Manually rejecting CHAT request from ${conn.peer}`);
                    const deny = () => {
                        conn.send({ _zynq: 'REJECTED' });
                        setTimeout(() => conn.close(), 500);
                    };
                    if (conn.open) deny(); else conn.on('open', deny);
                }
            });
        });

        this.peer.on('call', call => {
            this.log(`Incoming VIDEO call from: ${call.peer}`);
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async (localId, remoteId) => {
                    try {
                        this.log(`Accessing media devices for call with ${call.peer}`);
                        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this._bind(document.getElementById(localId), s);
                        call.answer(s);
                        this._setupMediaHandlers(call, remoteId);
                        this._emit('accepted', { id: call.peer, type: 'VIDEO' });
                    } catch (e) { 
                        this.log(`Media Error: ${e.message}`);
                        this._emit('error', e);
                    }
                },
                reject: () => {
                    this.log(`Rejecting VIDEO call from ${call.peer}`);
                    call.close();
                    this._emit('rejected', { id: call.peer, type: 'VIDEO' });
                }
            });
        });

        this.peer.on('error', err => {
            this.log(`Critical Peer Error: ${err.type} - ${err.message}`);
            this._emit('error', err);
        });
    }

    _setupDataHandlers(conn) {
        conn.on('open', () => {
            this.log(`Data channel with ${conn.peer} is now physicaly OPEN`);
            this.connections.set(conn.peer, conn);
        });

        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') {
                this.log(`Peer ${conn.peer} signals: ACCEPTED`);
                this._emit('accepted', { id: conn.peer, type: 'CHAT' });
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d?._zynq === 'REJECTED') {
                this.log(`Peer ${conn.peer} signals: REJECTED`);
                this._emit('rejected', { id: conn.peer, type: 'CHAT' });
                this._emit('status', `Rejected by ${conn.peer}`);
            } else {
                this.log(`Received message from ${conn.peer}`);
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        
        conn.on('close', () => {
            this.log(`Connection with ${conn.peer} CLOSED`);
            this.connections.delete(conn.peer);
            this._emit('disconnected', conn.peer);
            this._emit('status', `Disconnected from ${conn.peer}`);
        });

        conn.on('error', (err) => {
            this.log(`Connection error with ${conn.peer}: ${err}`);
        });
    }

    _setupMediaHandlers(call, remoteId) {
        call.on('stream', s => {
            this.log(`Received remote media stream from ${call.peer}`);
            this._bind(document.getElementById(remoteId), s);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });

        call.on('close', () => {
            this.log(`Media call with ${call.peer} ended`);
            this._emit('disconnected', call.peer);
        });
    }

    _bind(el, s) { 
        if (!el) {
            this.log(`Warning: Cannot bind stream, element not found`);
            return;
        }
        el.srcObject = s;
        el.onloadedmetadata = () => {
            el.play().catch(e => this.log(`Autoplay prevented: ${e.message}`));
        };
    }

    on(ev, cb) { this.events[ev] = cb; }

    _emit(ev, data) { 
        if (this.events[ev]) this.events[ev](data); 
    }

    connect(id) {
        if (!id) return;
        if (this.connections.has(id)) {
            this.log(`Already connected to ${id}`);
            return;
        }
        this.log(`Initiating connection request to ${id}...`);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    async call(id, localId, remoteId) {
        if (!id) return;
        try {
            this.log(`Starting video call to ${id}`);
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this._bind(document.getElementById(localId), s);
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call, remoteId);
        } catch (e) {
            this.log(`Call Setup Error: ${e.message}`);
        }
    }

    send(id, data) {
        const c = this.connections.get(id);
        if (c && c.open) {
            c.send(data);
            return true;
        }
        this.log(`Failed to send data: Connection to ${id} not open`);
        return false;
    }
};
