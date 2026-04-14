
/**
 * ZYNQ Core Library - Version: 1.5.2 (T47-ULTRA-LOW-LATENCY)
 * Optimized for: Zero Latency Buildup, Perfect GC, and Signal-based Call Reject.
 * 
 * Extra: aparte event-layer voor ALLE kleine signaling-dingen (sent, accepted, rejected, connected, etc.)
 * → Geen buildup, geen spam (geen event per chat-bericht), super simpel en clean.
 * → Events worden alleen gevuurd voor echte signalen (_zynq) en connect/accept/reject.
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
this.peer = new Peer(id, { config: this.rtcConfig, debug: 1 });
this.peer.on('open', assignedId => {
this.myId = assignedId;
this._emit('ready', assignedId);
});
// Handler voor inkomende data-verbindingen (Chat & Signaling)
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
this.send(conn.peer, { _zynq: 'ACCEPTED' });           // ← signaling → 'sent' event
this._registerSession(conn.peer, 'CHAT');
this._emit('accepted', { id: conn.peer, type: 'CHAT' });
this._emit('connected', { id: conn.peer, type: 'CHAT', direction: 'incoming' }); // aparte connected layer
},
reject: () => {
this.send(conn.peer, { _zynq: 'REJECTED' });           // ← signaling → 'sent' event
setTimeout(() => this._closeConnection(conn.peer), 100);
this._emit('rejected', { id: conn.peer, type: 'CHAT' });
}
});
}
}, 150); // iets korter voor nog lagere latency
});
// Handler voor inkomende Video-oproepen
this.peer.on('call', call => {
this._emit('incoming', {
from: call.peer, type: 'VIDEO',
accept: async (lId, rId) => {
const s = await this._getMediaStream();
if (lId && document.getElementById(lId)) document.getElementById(lId).srcObject = s;
call.answer(s);
this._setupMediaHandlers(call, rId);
this._emit('accepted', { id: call.peer, type: 'VIDEO' });
this._emit('connected', { id: call.peer, type: 'VIDEO', direction: 'incoming' });
},
reject: () => {
this.send(call.peer, { _zynq: 'REJECTED_VIDEO' });     // ← signaling → 'sent' event
call.close();
this._emit('rejected', { id: call.peer, type: 'VIDEO' });
}
});
});
}
async _getMediaStream() {
if (this.localStream) return this.localStream;
const stream = await navigator.mediaDevices.getUserMedia({
audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, latency: 0, sampleRate: 48000 },
video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
});
this.localStream = stream;
return stream;
}
_handleData(conn, data) {
if (!data || typeof data !== 'object') {
this._emit('message', { from: conn.peer, data: data });
return;
}
// Signaling Logica
switch (data._zynq) {
case 'ACCEPTED':
this._registerSession(conn.peer, 'CHAT');
this._emit('accepted', { id: conn.peer, type: 'CHAT' });
this._emit('connected', { id: conn.peer, type: 'CHAT', direction: 'outgoing' });
break;
case 'REJECTED':
this._emit('rejected', { id: conn.peer, type: 'CHAT' });
this._closeConnection(conn.peer);
break;
case 'REJECTED_VIDEO':
this._emit('rejected', { id: conn.peer, type: 'VIDEO' });
this._closeCall(conn.peer);
break;
default:
// Als het geen intern zynq signaal is, is het een chat bericht
if (!data._zynq) this._emit('message', { from: conn.peer, data: data });
}
}
_setupDataHandlers(conn) {
if (this.connections.has(conn.peer)) return;
this.connections.set(conn.peer, conn);
conn.on('close', () => this._closeConnection(conn.peer));
conn.on('error', () => this._closeConnection(conn.peer));
}
_setupMediaHandlers(call, rId) {
this.calls.set(call.peer, call);
call.on('stream', s => {
const videoEl = document.getElementById(rId);
if (rId && videoEl) {
videoEl.srcObject = s;
if ('playoutDelayHint' in videoEl) videoEl.playoutDelayHint = 0;
}
this._emit('stream', { id: call.peer, type: 'REMOTE', stream: s });
});
call.on('close', () => this._closeCall(call.peer, rId));
call.on('error', () => this._closeCall(call.peer, rId));
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
const videoEl = document.getElementById(rId);
if (videoEl) videoEl.srcObject = null;
this.activeSessions.delete(`${id}-VIDEO`);
this._emit('disconnected', { id, type: 'VIDEO' });
}
_registerSession(id, type) { this.activeSessions.add(`${id}-${type}`); }

/* === APARTE EVENT-LAYER VOOR SIGNALING === */
on(e, cb) { this.events[e] = cb; }
_emit(e, d) { if (this.events[e]) this.events[e](d); }

/* Public API */
connect(id) {
if (this.connections.has(id)) {
this._emit('connected', { id, type: 'CHAT', direction: 'outgoing' });
return;
}
const conn = this.peer.connect(id, { reliable: false });
conn.on('open', () => {
this._emit('connected', { id: id, type: 'CHAT', direction: 'outgoing' });
this._registerSession(id, 'CHAT');
});
this._setupDataHandlers(conn);
conn.on('data', d => this._handleData(conn, d));
}

send(id, msg) {
const c = this.connections.get(id);
if (c?.open) {
c.send(msg);
// Alleen signaling events (geen spam bij gewone chat-berichten)
if (msg && msg._zynq) {
this._emit('sent', { id, signal: msg._zynq, data: msg });
}
return true;
}
return false;
}

async call(id, lId, rId) {
const s = await this._getMediaStream();
if (lId && document.getElementById(lId)) document.getElementById(lId).srcObject = s;
this._emit('stream', { id: 'local', type: 'LOCAL', stream: s });
const callObj = this.peer.call(id, s);
this._setupMediaHandlers(callObj, rId);
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
const t = setTimeout(() => { if(!done){ conn.close(); resolve(false); } }, 2500);
conn.on('open', () => conn.send({ _zynq: 'CHECK_ONLINE' }));
conn.on('data', d => {
if(d?._zynq === 'PONG_ONLINE'){ done=true; clearTimeout(t); conn.close(); resolve(true); }
});
conn.on('error', () => { done=true; clearTimeout(t); resolve(false); });
});
}
};
