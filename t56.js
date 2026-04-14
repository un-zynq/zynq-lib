/**
 * ZYNQ Ultra-Secure & Performance Engine (t55.js)
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

    // We overschrijven de constructor om de extra logica te injecteren
    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);

        // Interne staat voor deze specifieke peer-instantie
        const _internal = {
            confirmedPeers: new Set(),
            activeStreams: new Map()
        };

        const _original = {
            call: peer.call.bind(peer),
            send: peer.send.bind(peer),
            emit: peer.emit.bind(peer) // Voor het triggeren van interne events
        };

        /**
         * Performance: Catch-up Engine
         */
        const optimizeStream = (vEle) => {
            const interval = setInterval(() => {
                if (!vEle) return clearInterval(interval);
                if (vEle.paused) return;

                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const delay = buffered.end(buffered.length - 1) - vEle.currentTime;
                    // Hard sync als delay > 0.5s
                    if (delay > 0.5) {
                        vEle.currentTime = buffered.end(buffered.length - 1) - 0.1;
                    }
                    // Soft sync (playback rate)
                    vEle.playbackRate = (delay > 0.3) ? 1.05 : 1.0;
                }
            }, 2000);
        };

        /**
         * Security: Overwrites
         */
        peer.call = function(id, options) {
            if (!id) return;
            if (_internal.confirmedPeers.has(id)) {
                return _original.call(id, options || { video: true, audio: true });
            } else {
                // Handshake protocol: verstuur verzoek via data kanaal
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

        /**
         * Event Listeners & Handlers
         */
        peer.on('message', ({ from, data }) => {
            if (data && data._sys) {
                switch (data.type) {
                    case "REQ":
                        // Nieuwe syntax: peer.on('call', e => ...)
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
        });

        /**
         * Public API
         */
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

    // Behoud prototype chain
    ZYNQ.Peer.prototype = OriginalPeer.prototype;

    return ZYNQ.Peer;
}));
