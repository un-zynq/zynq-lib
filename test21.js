window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
    constructor(config = {}) {
        this.events = {};
        this.connections = new Map();
        this.localVideo = document.getElementById(config.localId);
        this.remoteVideo = document.getElementById(config.remoteId);
        this._loadAndInit(config.id);
    }

    async _loadAndInit(id) {
        if (!window.Peer) {
            await new Promise(r => {
                const s = document.createElement('script');
                s.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
                s.onload = r;
                document.head.appendChild(s);
            });
        }
        this.peer = new Peer(id);
        this.peer.on('open', id => this._emit('ready', id));
        this.peer.on('connection', conn => this._handleIncomingData(conn));
        
        this.peer.on('call', call => {
            this._emit('request', {
                from: call.peer,
                type: 'CALL',
                accept: async () => {
                    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                    this._bindStream(this.localVideo, stream);
                    call.answer(stream);
                    this._setupMedia(call);
                    this._emit('open', { id: call.peer, type: 'CALL' });
                },
                reject: () => call.close()
            });
        });
    }

    _bindStream(el, stream) {
        if (el) {
            el.srcObject = stream;
            el.onloadedmetadata = () => el.play().catch(console.error);
        }
    }

    _setupMedia(call) {
        call.on('stream', remoteStream => {
            this._bindStream(this.remoteVideo, remoteStream);
            this._emit('open', { id: call.peer, type: 'CALL' });
        });
    }

    _handleIncomingData(conn) {
        this._emit('request', {
            from: conn.peer,
            type: 'CONNECT',
            accept: () => {
                this.connections.set(conn.peer, conn);
                this._setupDataEvents(conn);
                conn.on('open', () => {
                    conn.send({ _zynq: 'ACCEPTED' });
                    this._emit('open', { id: conn.peer, type: 'CHAT' });
                });
            },
            reject: () => {
                conn.on('open', () => {
                    conn.send({ _zynq: 'REJECTED' });
                    setTimeout(() => conn.close(), 500);
                });
            }
        });
    }

    _setupDataEvents(conn) {
        conn.on('data', data => {
            if (data._zynq === 'ACCEPTED') this._emit('open', { id: conn.peer, type: 'CHAT' });
            else if (data._zynq === 'REJECTED') this._emit('rejected', conn.peer);
            else this._emit('message', { from: conn.peer, data });
        });
        conn.on('close', () => {
            this.connections.delete(conn.peer);
            this._emit('close', conn.peer);
        });
    }

    on(ev, cb) { this.events[ev] = cb; }
    _emit(ev, data) { if (this.events[ev]) this.events[ev](data); }

    async call(id) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        this._bindStream(this.localVideo, stream);
        const call = this.peer.call(id, stream);
        this._setupMedia(call);
        return stream;
    }

    connect(id) {
        const conn = this.peer.connect(id);
        this.connections.set(id, conn);
        this._setupDataEvents(conn);
    }

    send(id, data) {
        const conn = this.connections.get(id);
        if (conn && conn.open) conn.send(data);
    }
};
