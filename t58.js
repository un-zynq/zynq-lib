/**
 * ZYNQ Ultra-Secure & Performance Engine (t58.js)
 * Focus: Stabiliteit, CPU-efficiëntie en jitter-reductie
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

    if (typeof ZYNQ === 'undefined' || !ZYNQ.Peer) {
        console.error("ZYNQ Engine Error: Base library not found!");
        return;
    }

    const OriginalPeer = ZYNQ.Peer;

    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);

        const _internal = {
            confirmedPeers: new Set(),
            activeStreams: new Map()
        };

        const _original = {
            call: peer.call.bind(peer),
            send: peer.send.bind(peer),
            emit: peer.emit.bind(peer)
        };

        /**
         * GEOPTIMALISEERDE PERFORMANCE ENGINE
         * Minimaliseert CPU gebruik door slimme drempelwaarden
         */
        const optimizeStream = (vEle) => {
            if (!vEle) return;
            
            // Browser hints voor lage latentie
            vEle.autoplay = true;
            vEle.playsInline = true;
            
            const syncInterval = setInterval(() => {
                if (!vEle || !vEle.srcObject) return clearInterval(syncInterval);
                if (vEle.paused || vEle.readyState < 3) return;

                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const latestTime = buffered.end(buffered.length - 1);
                    const delay = latestTime - vEle.currentTime;

                    // 1. Harde Sync (Bij grote spikes > 0.7s)
                    if (delay > 0.7) {
                        vEle.currentTime = latestTime - 0.05;
                        vEle.playbackRate = 1.0; // Reset naar normaal na sprong
                        return;
                    }

                    // 2. Soft Sync (Subtiele versnelling om buildup te voorkomen)
                    // We gebruiken een drempel van 0.2s om jitter te negeren
                    if (delay > 0.25) {
                        // Versnel naar 1.06 (vloeiend genoeg voor 60fps behoud)
                        if (vEle.playbackRate !== 1.06) vEle.playbackRate = 1.06;
                    } else if (delay < 0.15) {
                        // Terug naar normaal als we dicht genoeg bij de live-edge zijn
                        if (vEle.playbackRate !== 1.0) vEle.playbackRate = 1.0;
                    }
                }
            }, 800); // Check elke 800ms is de sweet spot voor CPU/Sync balans
        };

        peer.call = function(id, options) {
            if (!id) return;
            if (_internal.confirmedPeers.has(id)) {
                return _original.call(id, options || { video: true, audio: true });
            } else {
                _original.send(id, { _sys: true, type: "REQ", ts: Date.now() });
                _original.emit('call:sent', { to: id });
                return null;
            }
        };

        peer.send = function(id, data) {
            if (typeof data === 'string') {
                return _original.send(id, { _sys: false, body: data, ts: Date.now() });
            }
            return _original.send(id, data);
        };

        peer.on('message', ({ from, data }) => {
            if (data && data._sys) {
                switch (data.type) {
                    case "REQ":
                        _original.emit('call', {
                            from,
                            ts: data.ts,
                            accept: () => peer.acceptCall(from),
                            reject: () => peer.rejectCall(from)
                        });
                        break;
                    case "ACC":
                        _internal.confirmedPeers.add(from);
                        _original.emit('call:accepted', { from, ts: data.ts });
                        _original.call(from, { video: true, audio: true });
                        break;
                    case "REJ":
                        _original.emit('call:rejected', { from, ts: data.ts });
                        break;
                }
                return;
            }
            if (data && data.body) {
                _original.emit('secure:message', { from, text: data.body, ts: data.ts });
            }
        });

        peer.on('stream', ({ from, stream }) => {
            if (!_internal.confirmedPeers.has(from)) {
                stream.getTracks().forEach(t => t.stop());
                _original.emit('secure:violation', { from });
                return;
            }
            _internal.activeStreams.set(from, stream);
            _original.emit('secure:stream', { from, stream, optimize: optimizeStream });
        });

        peer.on('close', ({ id }) => {
            _internal.confirmedPeers.delete(id);
            const s = _internal.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            _internal.activeStreams.delete(id);
            _original.emit('secure:closed', { id });
        });

        peer.acceptCall = (id) => {
            _internal.confirmedPeers.add(id);
            _original.send(id, { _sys: true, type: "ACC", ts: Date.now() });
            _original.call(id, { video: true, audio: true });
        };

        peer.rejectCall = (id) => {
            _original.send(id, { _sys: true, type: "REJ", ts: Date.now() });
            _internal.confirmedPeers.delete(id);
        };

        return peer;
    };

    ZYNQ.Peer.prototype = OriginalPeer.prototype;
    return ZYNQ.Peer;
}));
