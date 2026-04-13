window.ZYNQ = window.ZYNQ || {};

ZYNQ.Peer = class {
  constructor(config = {}) {
    this.config = {
      video: config.video || false,
      audio: config.audio || false,
      txt: config.txt !== undefined ? config.txt : true,
      id: config.id || null
    };

    this.peer = null;
    this.connections = new Map(); // Data verbindingen
    this.calls = new Map();       // Media streams
    this.events = {};
    this.myId = null;

    this._loadPeerJS().then(() => this._initPeer());
  }

  // --- Internals ---
  async _loadPeerJS() {
    if (window.Peer) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = "https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("PeerJS kon niet laden."));
      document.head.appendChild(script);
    });
  }

  _initPeer() {
    this.peer = new Peer(this.config.id, { debug: 1 });

    this.peer.on('open', (id) => {
      this.myId = id;
      this._emit('ready', id);
    });

    // Inkomende data verbinding
    this.peer.on('connection', (conn) => {
      this._setupConn(conn);
      this._emit('request', { from: conn.peer, type: 'data' });
    });

    // Inkomende media call
    this.peer.on('call', (call) => {
      this._emit('request', { 
        from: call.peer, 
        type: 'media', 
        accept: (stream) => {
          call.answer(stream);
          this._setupCall(call);
        },
        reject: () => call.close()
      });
    });

    this.peer.on('error', (err) => this._emit('error', err));
  }

  _setupConn(conn) {
    conn.on('open', () => {
      this.connections.set(conn.peer, conn);
    });

    conn.on('data', (data) => {
      // Handshake logica
      if (data._zynqType === 'AUTH_ACCEPTED') {
        this._emit('accepted', { from: conn.peer });
        this._emit('open', conn.peer);
      } else if (data._zynqType === 'AUTH_REJECTED') {
        this._emit('rejected', { from: conn.peer });
        conn.close();
      } else {
        this._emit('message', { from: conn.peer, data });
      }
    });

    conn.on('close', () => {
      this.connections.delete(conn.peer);
      this._emit('close', { id: conn.peer });
    });
  }

  _setupCall(call) {
    call.on('stream', (stream) => {
      this._emit('stream', { from: call.peer, stream });
    });
    this.calls.set(call.peer, call);
  }

  _emit(event, data) {
    if (this.events[event]) this.events[event](data);
  }

  // --- Public API ---
  on(event, callback) {
    this.events[event] = callback;
  }

  connect(peerId) {
    const conn = this.peer.connect(peerId);
    this._setupConn(conn);
  }

  accept(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) conn.send({ _zynqType: 'AUTH_ACCEPTED' });
  }

  reject(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) {
      conn.send({ _zynqType: 'AUTH_REJECTED' });
      setTimeout(() => conn.close(), 500);
    }
  }

  send(peerId, msg) {
    if (peerId === "*") {
      this.connections.forEach(conn => conn.send(msg));
    } else {
      const conn = this.connections.get(peerId);
      if (conn) conn.send(msg);
      else {
        // Auto-connect
        const newConn = this.peer.connect(peerId);
        newConn.on('open', () => newConn.send(msg));
        this._setupConn(newConn);
      }
    }
  }

  call(peerId, config = { video: true, audio: true }) {
    navigator.mediaDevices.getUserMedia(config).then(stream => {
      const call = this.peer.call(peerId, stream);
      this._setupCall(call);
    });
  }

  disconnect(peerId) {
    const conn = this.connections.get(peerId);
    if (conn) conn.close();
    const call = this.calls.get(peerId);
    if (call) call.close();
  }
};
