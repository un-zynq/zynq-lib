window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map(); // Stores active DataConnections
        this.calls = new Map();       // Stores active MediaCalls
        this.localVideo = null;
        this.remoteVideo = null;
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
            this.log(`System Online. ID: ${id}`);
            this._emit('ready', id);
        });

        // Handle incoming Data Connections (Chat)
        this.peer.on('connection', conn => {
            this._setupDataHandlers(conn);
            this._emit('request', {
                from: conn.peer,
                type: 'CHAT',
                accept: () => {
                    this.log(`Chat accepted with [${conn.peer}]`);
                    const ok = () => { 
                        conn.send({ _zynq: 'ACCEPTED' }); 
                        this._emit('open', { id: conn.peer, type: 'CHAT' }); 
                    };
                    if (conn.open) ok(); else conn.on('open', ok);
                },
                reject: () => {
                    this.log(`[REJECT] You denied the request from ${conn.peer}.`);
                    const deny = () => {
                        conn.send({ _zynq: 'REJECTED' });
                    };
                    if (conn.open) deny(); else conn.on('open', deny);
                }
            });
        });

        // Handle incoming Media Calls (Video/Audio)
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'VIDEO',
                accept: async (localId, remoteId) => {
                    try {
                        this.localVideo = document.getElementById(localId);
                        this.remoteVideo = document.getElementById(remoteId);
                        
                        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this._bind(this.localVideo, stream);
                        
                        call.answer(stream);
                        this._setupMediaHandlers(call);
                    } catch (e) { 
                        this.log("Camera Error: " + e.message); 
                    }
                },
                reject: () => {
                    this.log(`Video call from ${call.peer} rejected.`);
                    call.close();
                }
            });
        });

        this.peer.on('error', err => {
            this.log(`Peer Error: ${err.type}`);
            this._emit('error', err);
        });
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);

        conn.on('data', d => {
            if (d?._zynq === 'ACCEPTED') {
                this.log(`[ACCEPTED] ${conn.peer} joined the chat.`);
                this._emit('open', { id: conn.peer, type: 'CHAT' });
            } else if (d?._zynq === 'REJECTED') {
                this.log(`[REJECTED] ${conn.peer} declined your request.`);
                this._emit('status', `Declined by ${conn.peer}`);
            } else {
                this._emit('message', { from: conn.peer, data: d });
            }
        });
        
        conn.on('close', () => {
            this.log(`[DISCONNECTED] ${conn.peer} left.`);
            this.connections.delete(conn.peer);
            this._emit('status', `Connection with ${conn.peer} closed`);
        });
    }

    _setupMediaHandlers(call) {
        this.calls.set(call.peer, call);

        call.on('stream', remoteStream => {
            this._bind(this.remoteVideo, remoteStream);
            this._emit('open', { id: call.peer, type: 'VIDEO' });
        });

        call.on('close', () => {
            this.log(`Media call with ${call.peer} ended.`);
            this.calls.delete(call.peer);
        });
    }

    _bind(el, stream) { 
        if (!el) return;
        el.srcObject = stream;
        el.onloadedmetadata = () => el.play().catch(e => this.log("Playback error: " + e));
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    // Start a Chat Connection
    connect(id) {
        if (!id) return;
        this.log(`Sending request to [${id}]...`);
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn);
    }

    // Start a Video Call
    async call(id, localId, remoteId) {
        if (!id) return;
        try {
            this.localVideo = document.getElementById(localId);
            this.remoteVideo = document.getElementById(remoteId);

            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this._bind(this.localVideo, stream);
            
            const call = this.peer.call(id, stream);
            this._setupMediaHandlers(call);
        } catch (e) {
            this.log("Call Error: " + e.message);
        }
    }

    // Send data to a specific peer
    send(id, data) {
        const c = this.connections.get(id);
        if (c && c.open) { 
            c.send(data); 
            return true; 
        }
        return false;
    }

    // Disconnect from a specific peer
    hangup(id) {
        if (this.connections.has(id)) {
            this.connections.get(id).close();
        }
        if (this.calls.has(id)) {
            this.calls.get(id).close();
        }
    }
};
