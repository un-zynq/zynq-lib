# ZYNQ Ultra-Secure & Performance Patch (secureCall.js)

The `t55.js` patch is a high-level wrapper for the `ZYNQ.Peer` library. It introduces a **Session-Based Handshake Protocol** to prevent unauthorized calls and a **Performance Engine** to eliminate video latency.

## Key Features
- **Strict Handshaking**: No media streams are exchanged until a call is explicitly accepted.
- **Session-Based Security**: Authorizations expire automatically when a connection closes.
- **Catch-up Engine**: Automatically synchronizes video streams if they lag more than 0.5s.
- **UMD Support**: Compatible with ES Modules (`import`), CommonJS (`require`), and standard `<script>` tags.

---

## Installation

### Standard Script Tag
Include the patch after the main ZYNQ library.
```html
<script src="path/to/zynq.js"></script>
<script src="path/to/t55.js"></script>
```

### Module Import
```javascript
import './path/to/t55.js';
const peer = new ZYNQ.Peer({ video: true, audio: true });
```

---

## API Reference

### `.call(id, options)`
Modified behavior. Instead of starting a media stream immediately, it sends a `REQ` (Request) handshake to the target peer.
- **Returns**: `null` if a handshake is required, or the `Call` object if the peer was already authorized in this session.

### `.acceptCall(id)`
Accepts an incoming handshake request. 
- Authorizes the peer for the current session.
- Sends an `ACC` (Accept) signal back.
- Automatically initiates the media call.

### `.rejectCall(id)`
Rejects an incoming handshake request.
- Sends a `REJ` (Reject) signal.
- Ensures the peer is removed from the authorized session list.

### `.send(id, data)`
Wraps string messages into a secure system object.
- If `data` is a string, it is sent as `{ _sys: false, body: data, ts: Date.now() }`.

---

## Events
The patch uses standard `window` CustomEvents for easy UI integration.

| Event Name | `event.detail` | Description |
|:---|:---|:---|
| `handshake:sent` | `{ to }` | Fired when you initiate a call to a new peer. |
| `handshake:request`| `{ from, ts }` | Fired when a peer is requesting to call you. |
| `handshake:accepted`| `{ from, ts }` | Fired when your call request is accepted. |
| `handshake:rejected`| `{ from, ts }` | Fired when your call request is rejected. |
| `secure:stream` | `{ from, stream, optimize }` | Fired when an authorized stream arrives. |
| `secure:message` | `{ from, text }` | Fired when a secure text message is received. |
| `secure:violation` | `{ from }` | Fired when an unauthorized peer tries to force a stream. |
| `secure:closed` | `{ id }` | Fired when a connection closes (Session Auth is wiped). |

---

## Implementation Example

### 1. Handling Incoming Handshakes
```javascript
window.addEventListener('handshake:request', (e) => {
    const callerId = e.detail.from;
    // Show your custom UI UI
    if (confirm(`Accept call from ${callerId}?`)) {
        peer.acceptCall(callerId);
    } else {
        peer.rejectCall(callerId);
    }
});
```

### 2. Rendering Authorized Streams
The `secure:stream` event provides an `optimize` function to handle the Catch-up Engine.
```javascript
window.addEventListener('secure:stream', (e) => {
    const { stream, optimize } = e.detail;
    const video = document.getElementById('remoteVideo');
    
    video.srcObject = stream;
    
    // Initialize the performance engine for this element
    optimize(video);
});
```

### 3. Security Violation Handling
If a user without the patch tries to call you, the patch detects the lack of a handshake, kills the stream tracks immediately, and fires this event:
```javascript
window.addEventListener('secure:violation', (e) => {
    console.error(`Unauthorized stream blocked from: ${e.detail.from}`);
});
```

---

## Performance Engine Logic
The `optimize` function runs every 2 seconds on the video element:
1. **Hard Catch-up**: If `currentTime` lags `buffer.end` by > 0.5s, it forces the video to the end.
2. **Soft Sync**: If the delay is > 0.3s, it sets `playbackRate` to `1.05` to catch up smoothly.
