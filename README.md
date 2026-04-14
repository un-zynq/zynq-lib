# ZYNQ Ultra-Secure & Performance Engine (`safeCall.js`)

A high-performance wrapper for the ZYNQ WebRTC library that implements a mandatory security handshake, adaptive resource management, and automated stream synchronization.

---

## Core Features

* **Mandatory Security Handshake**: Prevents unauthorized stream access. Connections are only established after a verified `REQ` (Request) and `ACC` (Accept) exchange.
* **Adaptive Performance Scaling**: Automatically detects system load. It adjusts frame rates and synchronization frequency based on the number of active peers (High, Medium, and Low-Power modes).
* **Intelligent Catch-up Engine**: Eliminates video lag by monitoring buffer depths and dynamically adjusting `playbackRate` to keep streams in near real-time.
* **Auto-Retry Logic**: Implements a robust 3-attempt handshake protocol to ensure connection reliability even on unstable networks.
* **Resource Protection**: Automatically terminates orphan tracks and stops media hardware when a peer disconnects to save CPU and battery.

---

## Implementation

### 1. Load Order
`safeCall.js` patches the global `ZYNQ` object. It **must** be loaded after the base library.

```html
<script src="https://cdn.jsdelivr.net/gh/un-zynq/zynq-lib@1.1.2/index.min.js"></script>
<script src="https://cdn.jsdelivr.net/gh/un-zynq/zynq-lib@1.1.2/safeCall.min.js"></script>
```

### 2. Initialization
Initialize the peer as usual. The security layers are injected automatically.

```javascript
const peer = new ZYNQ.Peer({
    video: true,
    audio: true
});
```

### 3. Handling Events
Use the `secure:` prefixed events to ensure you are interacting with verified encrypted streams.

```javascript
// Triggered when someone wants to connect
peer.on('call', (event) => {
    console.log("Call from:", event.from);
    // Use event.accept() or event.reject()
});

// Triggered when the secure stream is ready
peer.on('secure:stream', ({ from, stream, optimize }) => {
    const videoElement = document.getElementById('remote-video');
    videoElement.srcObject = stream;
    
    // Apply the performance engine to this specific element
    optimize(videoElement);
});

// Triggered when a peer disconnects
peer.on('secure:closed', ({ id }) => {
    console.log("Peer disconnected:", id);
});
```

---

## Technical Specifications

### Adaptive Modes
The engine monitors `activeStreams.size` and toggles between:
| Mode | Threshold | Optimization Behavior |
| :--- | :--- | :--- |
| **High** | 1-3 Peers | 60 FPS Sync, 800ms check interval, 1.06x speed-up. |
| **Medium** | 4-6 Peers | 15 FPS Sync, 1000ms check interval, 1.03x speed-up. |
| **Low** | 7+ Peers | 10 FPS Sync, 1500ms check interval, hardware-level throttling. |

### Security Protocol
1.  **REQ**: Sender initiates a system-level request.
2.  **ACC/REJ**: Receiver validates and sends back a signed response.
3.  **Stream**: WebRTC media tracks are only attached *after* the `ACC` event is registered in the internal `confirmedPeers` map.
4.  **Violation**: Any incoming stream attempt without a prior handshake triggers a `secure:violation` event and the tracks are immediately killed.

---

## License
Proprietary ZYNQ Ultra-Secure Engine. Distributed for use with the ZYNQ-lib ecosystem.
