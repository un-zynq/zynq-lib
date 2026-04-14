/**
 * ZYNQ Multi-Session WebRTC Wrapper
 * Version: 1.2.0 (English)
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor() {
        this.events = {};
        this.connections = new Map(); // id -> DataConnection
        this.calls = new Map();       // id -> MediaCall
        this.activeSessions = new Set();
        this._init(this._generateId());
    }

    _generateId() {
        const c = "ABCDEFGHJKLMNPRSTUVW", n = "23456789";
        const r = (s) => s[Math.floor(Math.random() * s.length)];
        return `${r(c)}${r(n)}${r(c)}-${r(c)}${r(n)}${r(c)}`;
    }

    async _init(id) {
        // Auto-load PeerJS if not present
        if (!window.Peer) {
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r; document.head.appendChild(s);
            });
        }

        this.peer = new Peer(id);

        this.peer.on('open', (assignedId) => {
            this._emit('ready', assignedId);
            this._emit('debug', `System initialized with ID: ${assignedId}`);
        });

        this.peer.on('error', (err) => {
            this._emit('error', err);
            this._emit('debug', `Peer Error: ${err.type}`);
        });

        // Handle incoming Data Connections
        this.peer.on('connection', (conn) => {
            this._setupDataHandlers(conn);
            
            // Wait for first data to check for PING vs REAL connection
            conn.on('data', (data) => {
                if (data?._zynq === 'PING') {
                    conn.send({ _zynq: 'PONG' });
                    setTimeout(() => conn.close(), 500);
                }
            });

            this._emit('incoming', { 
                from: conn.peer, 
                type: 'CHAT',
                accept: () => {
                    conn.send({ _zynq: 'ACCEPTED' });
                    this._registerSession(conn.peer, 'CHAT');
                    this._emit('accepted', { id: conn.peer, type: 'CHAT' });
                },
                reject: () => {
                    conn.send({ _zynq: 'REJECTED' });
                    this._emit('rejected', { id: conn.peer, type: 'CHAT' });
                    setTimeout(() => conn.close(), 100);
                }
            });
        });

        // Handle incoming Media Calls
        this.peer.on('call', (call) => {
            this._emit('incoming', {
                from: call.peer,
                type: 'VIDEO',
                accept: async (localVideoId, remoteVideoId) => {
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                        const localEl = document.getElementById(localVideoId);
                        if (localEl) localEl.srcObject = stream;
                        
                        call.answer(stream);
                        this._setupMediaHandlers(call, remoteVideoId);
                        this._emit('accepted', { id: call.peer, type: 'VIDEO' });
                    } catch (e) {
                        this._emit('debug', `Media Access Denied: ${e.message}`);
                    }
                },
                reject: () => {
                    call.close();
                    this._emit('rejected', { id: call.peer, type: 'VIDEO' });
                }
            });
        });
    }

    _registerSession(id, type) {
        const key = `${id}-${type}`;
        if (this.activeSessions.has(key)) return;
        this.activeSessions.add(key);
        this._emit('session_start', { id, type });
    }

    _setupDataHandlers(conn) {
        this.connections.set(conn.peer, conn);

        conn.on('open', () => this._emit('debug', `Data channel open with ${conn.peer}`));

        conn.on('data', (data) => {
            if (data?._zynq === 'ACCEPTED') {
                this._registerSession(conn.peer, 'CHAT');
                this._emit('accepted', { id: conn.peer, type: 'CHAT' });
            } else if (data?._zynq === 'REJECTED') {
                this._emit('rejected', { id: conn.peer, type: 'CHAT' });
            } else if (data?._zynq !== 'PING' && data?._zynq !== 'PONG') {
                this._emit('message', { from: conn.peer, data: data });
            }
        });

        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this.activeSessions.delete(`${conn.peer}-CHAT`);
            this._emit('disconnected', { id: conn.peer, type: 'CHAT' });
        });
    }

    _setupMediaHandlers(call, remoteVideoId) {
        this.calls.set(call.peer, call);

        call.on('stream', (remoteStream) => {
            const remoteEl = document.getElementById(remoteVideoId);
            if (remoteEl) remoteEl.srcObject = remoteStream;
            this._registerSession(call.peer, 'VIDEO');
        });

        call.on('close', () => {
            this.calls.delete(call.peer);
            this.activeSessions.delete(`${call.peer}-VIDEO`);
            this._emit('disconnected', { id: call.peer, type: 'VIDEO' });
        });
    }

    /**
     * Public Methods
     */

    on(event, callback) {
        this.events[event] = callback;
    }

    _emit(event, data) {
        if (this.events[event]) this.events[event](data);
    }

    connect(targetId) {
        if (this.connections.has(targetId)) return;
        const conn = this.peer.connect(targetId);
        this._setupDataHandlers(conn);
    }

    async call(targetId, localVideoId, remoteVideoId) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const localEl = document.getElementById(localVideoId);
            if (localEl) localEl.srcObject = stream;

            const call = this.peer.call(targetId, stream);
            this._setupMediaHandlers(call, remoteVideoId);
        } catch (e) {
            this._emit('debug', `Camera Error: ${e.message}`);
        }
    }

    send(targetId, message) {
        const conn = this.connections.get(targetId);
        if (conn && conn.open) {
            conn.send(message);
            return true;
        }
        return false;
    }

    async isOnline(targetId) {
        if (this.connections.has(targetId)) return true;
        return new Promise((resolve) => {
            const conn = this.peer.connect(targetId);
            let timeout = setTimeout(() => { conn.close(); resolve(false); }, 3000);
            
            conn.on('open', () => {
                conn.send({ _zynq: 'PING' });
            });
            conn.on('data', (data) => {
                if (data?._zynq === 'PONG') {
                    clearTimeout(timeout);
                    conn.close();
                    resolve(true);
                }
            });
            conn.on('error', () => {
                clearTimeout(timeout);
                resolve(false);
            });
        });
    }
};
