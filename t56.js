/**
 * ZYNQ Ultra-Secure & Performance Patch (t55.js)
 */
(function() {
    const OriginalPeer = ZYNQ.Peer;

    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);
        
        // --- State Management ---
        const safety = {
            confirmedPeers: new Set(),
            pendingRequest: null,
            activeStreams: new Map() // Voor garbage collection
        };

        const originalCall = peer.call.bind(peer);
        const originalSend = peer.send.bind(peer);

        // --- Performance & Catch-up Engine ---
        const optimizeStream = (vEle) => {
            setInterval(() => {
                if (!vEle || vEle.paused) return;
                
                // Catch-up: als we meer dan 0.5s achterlopen, skip naar live
                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const delay = buffered.end(buffered.length - 1) - vEle.currentTime;
                    if (delay > 0.5) { 
                        vEle.currentTime = buffered.end(buffered.length - 1) - 0.1;
                    }
                }
                
                // Playback rate aanpassen als de buffer buildup heeft
                if (vEle.buffered.length > 0 && (vEle.buffered.end(0) - vEle.currentTime > 0.3)) {
                    vEle.playbackRate = 1.05; // Iets sneller om in te halen
                } else {
                    vEle.playbackRate = 1.0;
                }
            }, 2000);
        };

        // --- Security Overwrites ---
        peer.call = function(id, options) {
            if (!id) return;
            if (safety.confirmedPeers.has(id)) {
                return originalCall(id, options || { video: true, audio: true });
            } else {
                originalSend(id, { _sys: true, type: "REQ", ts: Date.now() });
                window.dispatchEvent(new CustomEvent('handshake:sent', { detail: { to: id } }));
                return null;
            }
        };

        peer.send = function(id, data) {
            if (typeof data === 'string') {
                return originalSend(id, { _sys: false, body: data, ts: Date.now() });
            }
            return originalSend(id, data);
        };

        // --- Handlers & Trash Collection ---
        peer.on('message', ({ from, data }) => {
            if (data && data._sys) {
                switch(data.type) {
                    case "REQ":
                        safety.pendingRequest = from;
                        window.dispatchEvent(new CustomEvent('handshake:request', { detail: { from, ts: data.ts } }));
                        break;
                    case "ACC":
                        safety.confirmedPeers.add(from);
                        window.dispatchEvent(new CustomEvent('handshake:accepted', { detail: { from, ts: data.ts } }));
                        originalCall(from, { video: true, audio: true });
                        break;
                    case "REJ":
                        window.dispatchEvent(new CustomEvent('handshake:rejected', { detail: { from, ts: data.ts } }));
                        break;
                }
                return;
            }
            if (data && data.body) {
                window.dispatchEvent(new CustomEvent('secure:message', { detail: { from, text: data.body } }));
            }
        });

        peer.on('stream', ({ from, stream }) => {
            if (!safety.confirmedPeers.has(from)) {
                stream.getTracks().forEach(t => t.stop());
                window.dispatchEvent(new CustomEvent('secure:violation', { detail: { from } }));
                return;
            }
            
            safety.activeStreams.set(from, stream);
            window.dispatchEvent(new CustomEvent('secure:stream', { detail: { from, stream, optimize: optimizeStream } }));
        });

        // Garbage Collection: Ruim op als een peer wegvalt
        peer.on('close', ({ id }) => {
            safety.confirmedPeers.delete(id);
            const s = safety.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            safety.activeStreams.delete(id);
            window.dispatchEvent(new CustomEvent('secure:closed', { detail: { id } }));
        });

        // Interface methods
        peer.confirmHandshake = (id) => {
            safety.confirmedPeers.add(id);
            originalSend(id, { _sys: true, type: "ACC", ts: Date.now() });
            originalCall(id, { video: true, audio: true });
        };

        peer.denyHandshake = (id) => {
            originalSend(id, { _sys: true, type: "REJ", ts: Date.now() });
            safety.pendingRequest = null;
        };

        return peer;
    };

    ZYNQ.Peer.prototype = OriginalPeer.prototype;
})();
