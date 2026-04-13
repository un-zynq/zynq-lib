// secure-peer.js
export class SecurePeer {
  constructor(options = {}) {
    this.options = {
      video: options.video || false,
      audio: options.audio || false,
      txt: options.txt !== false,
      id: options.id || null
    };

    this.peer = new Peer(this.options.id ? { id: this.options.id } : {});
    this.connections = new Map();   // peerId → conn
    this.events = {};

    this.peer.on('open', (id) => {
      this.id = id;
      this.emit('ready', id);
    });

    this.peer.on('connection', (conn) => this._handleIncomingConnection(conn));
    this.peer.on('call', (call) => this.emit('call', call));
    this.peer.on('error', (err) => this.emit('error', err));
  }

  on(event, callback) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(callback);
  }

  emit(event, data) {
    if (this.events[event]) this.events[event].forEach(cb => cb(data));
  }

  _handleIncomingConnection(conn) {
    this.connections.set(conn.peer, conn);

    // Secure acceptatie: toon popup (of roep event aan)
    this.emit('incoming', conn.peer);

    conn.on('data', (data) => {
      if (data.type === "chat") {
        this.emit('message', { from: conn.peer, data: data.text });
      }
    });
  }

  connect(targetId) {
    const conn = this.peer.connect(targetId);
    this.connections.set(targetId, conn);

    conn.on('open', () => this.emit('open', targetId));

    conn.on('data', (data) => {
      if (data.type === "chat") {
        this.emit('message', { from: targetId, data: data.text });
      }
    });
  }

  send(targetId, message) {
    const conn = this.connections.get(targetId);
    if (conn) {
      conn.send({ type: "chat", text: message });
    }
  }

  call(targetId, options = {}) {
    navigator.mediaDevices.getUserMedia({
      video: options.video || false,
      audio: options.audio || false
    }).then(stream => {
      this.peer.call(targetId, stream);
    }).catch(err => this.emit('error', err));
  }

  disconnect(targetId) {
    const conn = this.connections.get(targetId);
    if (conn) {
      conn.close();
      this.connections.delete(targetId);
      this.emit('disconnect', { id: targetId });
    }
  }
}
