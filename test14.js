/**
 * ZYNQ v13 - High-Performance WebRTC Wrapper
 * Improved DX: Auto-binding, Async/Await, and Event Lifecycle
 */
window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.config = config;
        
        // DOM Elements for auto-binding
        this.localElement = document.getElementById(config.localId);
        this.remoteElement = document.getElementById(config.remoteId);
        
        this._init(config.id);
    }

    async _init(id) {
        if (!window.Peer) {
            await new Promise(resolve => {
                const script = document.createElement('script');
                script.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                script.onload = resolve;
                document.head.appendChild(script);
            });
        }
        
        this.peer = new Peer(id);
        
        this.peer.on('open', id => this._emit('ready', id));
        this.peer.on('error', err => this._emit('error', err));
        
        // Handle incoming Data Connections
        this.peer.on('connection', conn => this._handleIncomingData(conn));
        
        // Handle incoming Media Calls
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'CALL',
                accept: async () => {
                    const stream = await this._getUserMedia();
                    this._bind(this.localElement, stream);
                    call.answer(stream);
                    this._setupMediaEvents(call);
                    this._emit('connected', call.peer);
                    return stream;
                },
                reject: () => call.close()
            });
        });
    }

    async _getUserMedia() {
        return await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
    }

    _bind(el, stream) {
        if (el) {
            el.srcObject = stream;
            el.onloadedmetadata = () => el.play().catch(e => this._emit('error', e));
        }
    }

    _setupMediaEvents(call) {
        call.on('stream', stream => {
            this._bind(this.remoteElement, stream);
            this._emit('stream', { from: call.peer, stream });
        });
        call.on('close', () => this._emit('disconnected', call.peer));
    }

    _handleIncomingData(conn) {
        this._emit('request', {
            from: conn.peer,
            type: 'CHAT',
            accept: () => {
                this.connections.set(conn.peer, conn);
                this._setupDataEvents(conn);
                conn.on('open', () => {
                    conn.send({ _zynq: 'ACK' });
                    this._emit('connected', conn.peer);
                });
            },
            reject: () => {
                conn.on('open', () => {
                    conn.send({ _zynq: 'NAK' });
                    setTimeout(() => conn.close(), 500);
                });
            }
        });
    }

    _setupDataEvents(conn) {
        conn.on('data', data => {
            if (data._zynq === 'ACK') this._emit('connected', conn.peer);
            else if (data._zynq === 'NAK') this._emit('rejected', conn.peer);
            else this._emit('message', { from: conn.peer, data });
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('disconnected', conn.peer);
        });
    }

    // Public API
    on(event, callback) { this.events[event] = callback; }
    _emit(event, data) { if (this.events[event]) this.events[event](data); }

    async call(targetId) {
        const stream = await this._getUserMedia();
        this._bind(this.localElement, stream);
        const call = this.peer.call(targetId, stream);
        this._setupMediaEvents(call);
        this._emit('connected', targetId);
        return stream;
    }

    send(targetId, data) {
        const conn = this.connections.get(targetId);
        if (conn && conn.open) conn.send(data);
    }
};
