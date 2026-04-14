/**
 * ZYNQ Ultra-Secure & Performance Patch (t55.js)
 * Versie: 1.2 - ESM & Script Tag Support + Session Handshake
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    
    // Controleer of de basisbibliotheek aanwezig is
    if (typeof ZYNQ === 'undefined' || !ZYNQ.Peer) {
        console.error("ZYNQ Patch Error: Basis ZYNQ library niet gevonden.");
        return;
    }

    const OriginalPeer = ZYNQ.Peer;

    const PatchedPeer = function(config) {
        const peer = new OriginalPeer(config);
        
        const safety = {
            confirmedPeers: new Set(),
            activeStreams: new Map() 
        };

        const originalCall = peer.call.bind(peer);
        const originalSend = peer.send.bind(peer);

        const optimizeStream = (vEle) => {
            const interval = setInterval(() => {
                if (!vEle) return clearInterval(interval);
                if (vEle.paused) return;
                
                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const delay = buffered.end(buffered.length - 1) - vEle.currentTime;
                    if (delay > 0.5) { 
                        vEle.currentTime = buffered.end(buffered.length - 1) - 0.1;
                    }
                    vEle.playbackRate = (delay > 0.3) ? 1.05 : 1.0;
                }
            }, 2000);
        };

        // Overwrites
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

        peer.on('message', ({ from, data }) => {
            if (data && data._sys) {
                switch(data.type) {
                    case "REQ":
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

        peer.on('close', ({ id }) => {
            safety.confirmedPeers.delete(id); // Reset handshake voor nieuwe sessie
            const s = safety.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            safety.activeStreams.delete(id);
            window.dispatchEvent(new CustomEvent('secure:closed', { detail: { id } }));
        });

        // Interface
        peer.acceptCall = (id) => {
            safety.confirmedPeers.add(id);
            originalSend(id, { _sys: true, type: "ACC", ts: Date.now() });
            originalCall(id, { video: true, audio: true });
        };

        peer.rejectCall = (id) => {
            originalSend(id, { _sys: true, type: "REJ", ts: Date.now() });
            safety.confirmedPeers.delete(id);
        };

        return peer;
    };

    // Zorg dat prototype overgeërfd wordt
    PatchedPeer.prototype = OriginalPeer.prototype;
    
    // Overschrijf de globale ZYNQ.Peer
    ZYNQ.Peer = PatchedPeer;

    return PatchedPeer;
}));
