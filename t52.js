/**
 * ZYNQ Core Library - Version: 1.5.0 (T47-ULTRA-LOW-LATENCY)
 * Optimized for: Zero Latency Buildup, Perfect GC, Long-duration calls.
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor() {
        this.events = {};
        this.connections = new Map(); 
        this.calls = new Map();        
        this.activeSessions = new Set();
        this.localStream = null;
        this.myId = null;
        
        // RTC Configuratie voor minimale vertraging
        this.rtcConfig = {
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            sdpSemantics: 'unified-plan',
            bundlePolicy: 'max-bundle'
        };

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
        
        // Initialiseer Peer met RTC config
        this.peer = new Peer(id, { config: this.rtcConfig, debug: 1 });
        
        this.peer.on('open', assignedId => {
            this.myId = assignedId;
            this._emit('ready', assignedId);
        });

        this.peer.on('connection', conn => {
            conn.on('data', data => {
                if (data?._zynq === 'CHECK_ONLINE') {
                    conn.isSilent = true;
                    conn.send({ _zynq: 'PONG_ONLINE' });
                    setTimeout(() => conn.close(), 100);
                    return;
                }
                this._handleData(conn, data);
            });

            setTimeout(() => {
                if (!conn.isSilent) {
                    this._setupDataHandlers(conn);
                    this._emit('incoming', { 
                        from: conn.peer, type: 'CHAT',
                        accept: () => {
                            conn.send({ _zynq: 'ACCEPTED' });
                            this._registerSession(conn.peer, 'CHAT');
                            this._emit('accepted', { id: conn.peer, type: 'CHAT' });
                        },
                        reject: () => {
                            conn.send({ _zynq: 'REJECTED' });
                            setTimeout(() => this._closeConnection(conn.peer), 100);
                        }
                    });
                }
            }, 200);
        });

        this.peer.on('call', call => {
            this._emit('incoming', {
                from: call.peer, type: 'VIDEO',
                accept: async (lId, rId) => {
                    const s = await this._getMediaStream();
                    if (lId && document.getElementById(lId)) document.getElementById(lId).srcObject = s;
                    call.answer(s);
                    this._setupMediaHandlers(call, rId);
                    this._emit('accepted', { id: call.peer, type: 'VIDEO' });
                },
                reject: () => call.close()
            });
        });
    }

    // Geoptimaliseerde Media Constraints voor lage latency
    async _getMediaStream() {
        if (this.localStream) return this.localStream;
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                latency: 0, // Forceer laagste latency
                sampleRate: 48000
            },
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        });
        this.localStream = stream;
        return stream;
    }

    _handleData(conn, data) {
        if (data?._zynq === 'ACCEPTED') {
            this._registerSession(conn.peer, 'CHAT');
            this._emit('accepted', { id: conn.peer, type: 'CHAT' });
        } else if (data?._zynq === 'REJECTED') {
            this._emit('rejected', { id: conn.peer });
            this._closeConnection(conn.peer);
        } else if (data && (typeof data !== 'object' || !data._zynq)) {
            this._emit('message', { from: conn.peer, data: data });
        }
    }

    _setupDataHandlers(conn) {
        if (this.connections.has(conn.peer)) return;
        this.connections.set(conn.peer, conn);
        conn.on('close', () => this._closeConnection(conn.peer));
    }

    _setupMediaHandlers(call, rId) {
        this.calls.set(call.peer, call);
        
        // Low latency audio fix: schakel playout delay uit in Chrome/Edge
        call.on('stream', s => {
            const videoEl = document.getElementById(rId);
            if (rId && videoEl) {
                videoEl.srcObject = s;
                // Forceer geen buffering in browser
                if (videoEl.setSinkId && 'playoutDelayHint' in videoEl) {
                    videoEl.playoutDelayHint = 0;
                }
            }
            this._emit('stream', { id: call.peer, type: 'REMOTE', stream: s });
        });

        call.on('close', () => this._closeCall(call.peer, rId));
    }

    _closeConnection(id) {
        const conn = this.connections.get(id);
        if (conn) { conn.close(); this.connections.delete(id); }
        this.activeSessions.delete(`${id}-CHAT`);
        this._emit('disconnected', { id, type: 'CHAT' });
    }

    _closeCall(id, rId) {
        const call = this.calls.get(id);
        if (call) { call.close(); this.calls.delete(id); }
        if (this.calls.size === 0 && this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }
        if (rId && document.getElementById(rId)) document.getElementById(rId).srcObject = null;
        this.activeSessions.delete(`${id}-VIDEO`);
        this._emit('disconnected', { id, type: 'VIDEO' });
    }

    _registerSession(id, type) { this.activeSessions.add(`${id}-${type}`); }
    on(e, cb) { this.events[e] = cb; }
    _emit(e, d) { if (this.events[e]) this.events[e](d); }

    connect(id) { 
        const conn = this.peer.connect(id, { reliable: false }); // Unreliable = sneller voor realtime
        this._setupDataHandlers(conn); 
        conn.on('data', d => this._handleData(conn, d));
    }

    send(id, msg) {
        const c = this.connections.get(id);
        if (c?.open) { c.send(msg); return true; }
        return false;
    }

    async call(id, lId, rId) {
        const s = await this._getMediaStream();
        if (lId && document.getElementById(lId)) document.getElementById(lId).srcObject = s;
        this._emit('stream', { id: 'local', type: 'LOCAL', stream: s });
        
        const call = this.peer.call(id, s);
        this._setupMediaHandlers(call, rId);
    }

    destroy() {
        this.connections.forEach((_, id) => this._closeConnection(id));
        this.calls.forEach((_, id) => this._closeCall(id));
        if (this.peer) this.peer.destroy();
    }

    isOnline(id) {
        return new Promise(resolve => {
            const conn = this.peer.connect(id, { reliable: true });
            let done = false;
            const t = setTimeout(() => { if(!done){ conn.close(); resolve(false); } }, 3500);
            conn.on('open', () => conn.send({ _zynq: 'CHECK_ONLINE' }));
            conn.on('data', d => {
                if(d?._zynq === 'PONG_ONLINE'){ done=true; clearTimeout(t); conn.close(); resolve(true); }
            });
            conn.on('error', () => { done=true; clearTimeout(t); resolve(false); });
        });
    }
};
