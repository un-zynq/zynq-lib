/**
 * ZYNQ Ultra-Secure & Performance Engine (t56.js)
 * Integreert handshakes en latency-correctie direct in de ZYNQ.Peer
 */
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {

    // Controleer of ZYNQ geladen is (index.js)
    if (typeof ZYNQ === 'undefined' || !ZYNQ.Peer) {
        console.error("ZYNQ Engine Error: Base library (index.js) not found!");
        return;
    }

    const OriginalPeer = ZYNQ.Peer;

    ZYNQ.Peer = function(config) {
        // Maak de echte peer aan via de originele constructor uit index.js
        const peer = new OriginalPeer(config);

        // Interne beveiligingsstatus
        const _internal = {
            confirmedPeers: new Set(),
            activeStreams: new Map()
        };

        // Backup van originele methoden
        const _originalCall = peer.call.bind(peer);
        const _originalSend = peer.send.bind(peer);
        const _originalEmit = peer.emit.bind(peer);

        /**
         * Performance: Catch-up Engine
         * Voorkomt dat video achter gaat lopen (lag)
         */
        const optimizeStream = (vEle) => {
            if (!vEle) return;
            vEle.autoplay = true;
            vEle.playsInline = true;

            const interval = setInterval(() => {
                if (!vEle || !vEle.srcObject) return clearInterval(interval);
                if (vEle.paused) return;

                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const delay = buffered.end(buffered.length - 1) - vEle.currentTime;
                    
                    // Als de vertraging groter is dan 0.5s, spring naar live
                    if (delay > 0.5) {
                        vEle.currentTime = buffered.end(buffered.length - 1) - 0.05;
                    }
                    // Subtiel versnellen bij kleine buildup
                    vEle.playbackRate = (delay > 0.2) ? 1.08 : 1.0;
                }
            }, 1000); // Check elke seconde voor maximale stabiliteit
        };

        /**
         * Handshake Logica overschrijven
         */
        peer.call = function(id, options) {
            if (!id) return;
            
            if (_internal.confirmedPeers.has(id)) {
                // Al bevestigd? Dan gewone call
                return _originalCall(id, options || { video: true, audio: true });
            } else {
                // Niet bevestigd? Stuur SYSTEEM-REQ (handshake)
                _originalSend(id, { _sys: true, type: "REQ", ts: Date.now() });
                _originalEmit('call:sent', { to: id });
                return null;
            }
        };

        // Berichten automatisch wrappen voor veiligheid
        peer.send = function(id, data) {
            if (typeof data === 'string') {
                return _originalSend(id, { _sys: false, body: data, ts: Date.now() });
            }
            return _originalSend(id, data);
        };

        /**
         * Event Interceptie
         */
        peer.on('message', ({ from, data }) => {
            if (data && data._sys) {
                switch (data.type) {
                    case "REQ":
                        // Trigger het 'call' event met accept/reject helpers
                        _originalEmit('call', {
                            from,
                            ts: data.ts,
                            accept: () => peer.acceptCall(from),
                            reject: () => peer.rejectCall(from)
                        });
                        break;
                    case "ACC":
                        _internal.confirmedPeers.add(from);
                        _originalEmit('call:accepted', { from, ts: data.ts });
                        // Start nu pas de echte WebRTC call
                        _originalCall(from, { video: true, audio: true });
                        break;
                    case "REJ":
                        _originalEmit('call:rejected', { from, ts: data.ts });
                        break;
                }
                return;
            }
            
            // Normale berichten doorsturen als secure:message
            if (data && data.body) {
                _originalEmit('secure:message', { from, text: data.body, ts: data.ts });
            }
        });

        // Media Stream Beveiliging
        peer.on('stream', ({ from, stream }) => {
            if (!_internal.confirmedPeers.has(from)) {
                // Geen handshake? Kill de stream direct!
                stream.getTracks().forEach(t => t.stop());
                _originalEmit('secure:violation', { from });
                return;
            }
            
            _internal.activeStreams.set(from, stream);
            // Geef de stream door met de optimizer tool
            _originalEmit('secure:stream', { from, stream, optimize: optimizeStream });
        });

        // Sessie beëindigen bij close
        peer.on('close', ({ id }) => {
            _internal.confirmedPeers.delete(id);
            const s = _internal.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            _internal.activeStreams.delete(id);
        });

        /**
         * Helper Methods
         */
        peer.acceptCall = (id) => {
            _internal.confirmedPeers.add(id);
            _originalSend(id, { _sys: true, type: "ACC", ts: Date.now() });
            _originalCall(id, { video: true, audio: true });
        };

        peer.rejectCall = (id) => {
            _originalSend(id, { _sys: true, type: "REJ", ts: Date.now() });
            _internal.confirmedPeers.delete(id);
        };

        return peer;
    };

    // Prototype overzetten van Original (index.js) naar de nieuwe constructor
    ZYNQ.Peer.prototype = OriginalPeer.prototype;

    return ZYNQ.Peer;
}));
