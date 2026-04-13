/**
 * De "Engine" die puur de PeerJS communicatie regelt.
 */
class SecurePeerEngine {
  constructor(onLog, onIncomingCall, onData, onChatActive) {
    this.peer = new Peer({ debug: 2 });
    this.conn = null;
    this.onLog = onLog;
    this.onIncomingCall = onIncomingCall;
    this.onData = onData;
    this.onChatActive = onChatActive;

    this.init();
  }

  init() {
    this.peer.on('open', (id) => this.onLog(`✅ Peer klaar: ${id}`, '#00ffcc', id));
    this.peer.on('error', (err) => this.onLog(`❌ Fout: ${err.type}`, '#ff5555'));

    // Luister naar binnenkomende verbindingen
    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this.onIncomingCall(conn.peer);
      this._setupEventListeners();
    });
  }

  connect(targetId) {
    this.conn = this.peer.connect(targetId);
    this._setupEventListeners();
  }

  _setupEventListeners() {
    this.conn.on('open', () => {
      this.onLog(`Verbonden met ${this.conn.peer}. Wachten op acceptatie...`, '#ffff00');
    });

    this.conn.on('data', (data) => {
      if (data.type === "accepted") {
        this.onChatActive(this.conn.peer);
      } else if (data.type === "rejected") {
        this.onLog("❌ Verzoek geweigerd.", "#ff6666");
        this.conn.close();
      } else {
        this.onData(data); // Stuur chat-data door naar de UI
      }
    });
  }

  send(type, payload = {}) {
    if (this.conn && this.conn.open) {
      this.conn.send({ type, ...payload });
    }
  }
}
