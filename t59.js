/**
 * ZYNQ Ultra-Secure & Performance Engine (t59.js)
 * FIX: Betrouwbare Handshake & Verbindings-wachtrij
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
        console.error("ZYNQ Engine Error: index.js niet geladen!");
        return;
    }

    const OriginalPeer = ZYNQ.Peer;

    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);
        const _internal = {
            confirmedPeers: new Set(),
            activeStreams: new Map(),
            handshakeRetries: new Map()
        };

        const _original = {
            call: peer.call.bind(peer),
            send: peer.send.bind(peer),
            emit: peer.emit.bind(peer)
        };

        // Performance Engine (Houdt FPS stabiel)
        const optimizeStream = (vEle) => {
            if (!vEle) return;
            const syncInterval = setInterval(() => {
                if (!vEle || !vEle.srcObject) return clearInterval(syncInterval);
                if (vEle.paused || vEle.readyState < 3) return;
                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const delay = buffered.end(buffered.length - 1) - vEle.currentTime;
                    if (delay > 0.7) vEle.currentTime = buffered.end(buffered.length - 1) - 0.05;
                    vEle.playbackRate = (delay > 0.25) ? 1.06 : (delay < 0.15 ? 1.0 : vEle.playbackRate);
                }
            }, 800);
        };

        // FIX: Handshake verzenden met garantie
        const safeHandshake = (id) => {
            if (_internal.confirmedPeers.has(id)) return;
            
            console.log(`[ZYNQ] Poging handshake naar ${id}...`);
            _original.send(id, { _sys: true, type: "REQ", ts: Date.now() });

            // Als we na 2 seconden geen ACC of REJ hebben, probeer het nog 1x
            const retryCount = _internal.handshakeRetries.get(id) || 0;
            if (retryCount < 2) {
                setTimeout(() => {
                    if (!_internal.confirmedPeers.has(id)) {
                        _internal.handshakeRetries.set(id, retryCount + 1);
                        safeHandshake(id);
                    }
                }, 2000);
            }
        };

        peer.call = function(id, options) {
            if (!id) return;
            if (_internal.confirmedPeers.has(id)) {
                return _original.call(id, options || { video: true, audio: true });
            } else {
                safeHandshake(id);
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
            if (!data) return;
            if (data._sys) {
                switch (data.type) {
                    case "REQ":
                        _original.emit('call', {
                            from, ts: data.ts,
                            accept: () => peer.acceptCall(from),
                            reject: () => peer.rejectCall(from)
                        });
                        break;
                    case "ACC":
                        _internal.confirmedPeers.add(from);
                        _internal.handshakeRetries.delete(from);
                        _original.emit('call:accepted', { from, ts: data.ts });
                        // Vertraging toevoegen zodat datakanaal tijd heeft om de status te verwerken
                        setTimeout(() => _original.call(from, { video: true, audio: true }), 100);
                        break;
                    case "REJ":
                        _internal.handshakeRetries.delete(from);
                        _original.emit('call:rejected', { from, ts: data.ts });
                        break;
                }
            } else if (data.body) {
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
            _internal.handshakeRetries.delete(id);
            const s = _internal.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            _internal.activeStreams.delete(id);
            _original.emit('secure:closed', { id });
        });

        peer.acceptCall = (id) => {
            _internal.confirmedPeers.add(id);
            _original.send(id, { _sys: true, type: "ACC", ts: Date.now() });
            setTimeout(() => _original.call(id, { video: true, audio: true }), 100);
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
