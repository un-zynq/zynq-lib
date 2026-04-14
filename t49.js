/**
 * ZYNQ Core Library - Version: 1.4.1 (T47-Optimized)
 * Full Event Handling & Duplicate Prevention
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor() {
        this.events = {};
        this.connections = new Map(); 
        this.calls = new Map();        
        this.activeSessions = new Set();
        this._emittedStates = new Set(); // Voorkomt dubbele events
        this.myId = null;
        this._init(this._generateId());
    }

    _generateId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
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

        this.peer.on('open', (assignedId) => {
            this.myId = assignedId;
            this._smartEmit('ready', assignedId);
        });

        // --- INKOMENDE DATA/CHAT ---
        this.peer.on('connection', (conn) => {
            this._setupDataHandlers(conn);
            
            // Timeout om te checken of het een 'silent' online check is
            const checkTimeout = setTimeout(() => {
                if (!conn.isSilent) {
                    this._smartEmit('incoming', { 
                        from: conn.peer, 
                        type: 'CHAT',
                        accept: () => {
                            conn.send({ _zynq: 'ACCEPTED', _type: 'CHAT' });
                            this._registerSession(conn.peer, 'CHAT');
                            this._smartEmit('accepted', { id: conn.peer, type: 'CHAT' });
                        },
                        reject: () => {
                            conn.send({ _zynq: 'REJECTED', _type: 'CHAT' });
                            this._smartEmit('rejected', { id: conn.peer, type: 'CHAT' });
                            setTimeout(() => conn.close(), 100);
                        }
                    });
                }
            }, 250);

            conn.on('data', (d) => { if(d?._zynq === 'CHECK_ONLINE') conn.isSilent = true; });
        });

        // --- INKOMENDE CALL ---
        this.peer.on('call', (call) => {
            this._smartEmit('incoming', {
                from: call.peer, 
                type: 'VIDEO',
                accept: async (localElemId, remoteElemId) => {
                    try {
                        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        this._handleStream(s, localElemId, 'local', 'LOCAL');
                        call.answer(s);
                        this._setupMediaHandlers(call, remoteElemId);
                        this._smartEmit('accepted', { id: call.peer, type: 'VIDEO' });
                    } catch (err) {
                        console.error("Camera access denied", err);
                        call.close();
                    }
                },
                reject: () => {
                    // Stuur via een data-kanaal (indien open) of sluit gewoon
                    const conn = this.connections.get(call.peer);
                    if (conn) conn.send({ _zynq: 'REJECTED', _type: 'VIDEO' });
                    this._smartEmit('rejected', { id: call.peer, type: 'VIDEO' });
                    call.close();
                }
            });
        });
    }

    _handleData(conn, data) {
        if (!data?._zynq) {
            this._smartEmit('message', { from: conn.peer, data: data });
            return;
        }

        const type = data._type || 'CHAT';
        switch (data._zynq) {
            case 'ACCEPTED':
                this._registerSession(conn.peer, type);
                this._smartEmit('accepted', { id: conn.peer, type: type });
                break;
            case 'REJECTED':
                this._smartEmit('rejected', { id: conn.peer, type: type });
                break;
            case 'PONG_ONLINE':
                // Afgehandeld in isOnline promise
                break;
        }
    }

    _setupDataHandlers(conn) {
        if (this.connections.has(conn.peer)) return;
        this.connections.set(conn.peer, conn);

        conn.on('data', (data) => this._handleData(conn, data));
        
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.activeSessions.delete(`${conn.peer}-CHAT`);
            this._smartEmit('disconnected', { id: conn.peer, type: 'CHAT' });
        });

        conn.on('error', () => conn.close());
    }

    _setupMediaHandlers(call, remoteElemId) {
        this.calls.set(call.peer, call);

        call.on('stream', s => {
            this._handleStream(s, remoteElemId, call.peer, 'REMOTE');
        });

        call.on('close', () => {
            this.calls.delete(call.peer);
            this.activeSessions.delete(`${call.peer}-VIDEO`);
            this._smartEmit('disconnected', { id: call.peer, type: 'VIDEO' });
        });
    }

    _handleStream(stream, elemId, peerId, type) {
        if (elemId && document.getElementById(elemId)) {
            document.getElementById(elemId).srcObject = stream;
        }
        this._smartEmit('stream', { id: peerId, type: type, stream: stream });
    }

    _smartEmit(event, data) {
        // Maak een unieke key voor state-veranderende events (niet voor chat berichten)
        const stateKey = event === 'message' ? null : `${event}-${data?.id || data}-${data?.type || ''}`;
        
        if (stateKey && this._emittedStates.has(stateKey)) return;
        
        if (stateKey) {
            this._emittedStates.add(stateKey);
            // Reset state na 1 seconde om herhaling later wel toe te staan (bijv. opnieuw bellen)
            setTimeout(() => this._emittedStates.delete(stateKey), 1000);
        }

        if (this.events[event]) this.events[event](data);
    }

    _registerSession(id, type) { 
        this.activeSessions.add(`${id}-${type}`); 
    }

    on(e, cb) { this.events[e] = cb; }

    // --- PUBLIC METHODS ---

    isOnline(id) {
        return new Promise((resolve) => {
            const conn = this.peer.connect(id, { reliable: true });
            let done = false;
            const t = setTimeout(() => { if(!done){ conn.close(); resolve(false); } }, 3000);
            
            conn.on('open', () => conn.send({ _zynq: 'CHECK_ONLINE' }));
            conn.on('data', d => {
                if(d?._zynq === 'PONG_ONLINE'){ done=true; clearTimeout(t); conn.close(); resolve(true); }
            });
            conn.on('error', () => { done=true; clearTimeout(t); resolve(false); });
        });
    }

    connect(id) { 
        const conn = this.peer.connect(id);
        this._setupDataHandlers(conn); 
    }

    send(id, msg) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(msg); return true; }
        return false;
    }

    call(id, localElemId, remoteElemId) {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(s => {
            this._handleStream(s, localElemId, 'local', 'LOCAL');
            const call = this.peer.call(id, s);
            this._setupMediaHandlers(call, remoteElemId);
        }).catch(err => {
            this._smartEmit('error', { message: "Could not start camera", error: err });
        });
    }

    disconnect(id) {
        const c = this.connections.get(id); if (c) c.close();
        const call = this.calls.get(id); if (call) call.close();
        this._emittedStates.clear(); // Reset states bij handmatige disconnect
    }
};
