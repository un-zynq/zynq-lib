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
        console.error("ZYNQ Engine Error: Base library not found");
        return;
    }
    const OriginalPeer = ZYNQ.Peer;
    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);
        const _internal = {
            confirmedPeers: new Set(),
            activeStreams: new Map(),
            performanceMode: 'high'
        };
        const _original = {
            call: peer.call.bind(peer),
            send: peer.send.bind(peer),
            emit: peer.emit.bind(peer)
        };
        const adaptiveThrottle = () => {
            const count = _internal.activeStreams.size;
            if (count > 6) return 'low';
            if (count > 3) return 'medium';
            return 'high';
        };
        const optimizeStream = (vEle) => {
            if (!vEle) return;
            let lastCheck = Date.now();
            const syncInterval = setInterval(() => {
                if (!vEle || !vEle.srcObject) return clearInterval(syncInterval);
                if (vEle.paused || vEle.readyState < 3) return;
                const mode = adaptiveThrottle();
                const now = Date.now();
                if (mode === 'low' && now - lastCheck < 1500) return;
                if (mode === 'medium' && now - lastCheck < 1000) return;
                lastCheck = now;
                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const latest = buffered.end(buffered.length - 1);
                    const delay = latest - vEle.currentTime;
                    if (delay > 0.8) {
                        vEle.currentTime = latest - 0.02;
                    } else if (delay > 0.2) {
                        vEle.playbackRate = mode === 'high' ? 1.06 : 1.03;
                    } else {
                        vEle.playbackRate = 1.0;
                    }
                }
            }, 800);
        };
        const safeHandshake = (id) => {
            if (_internal.confirmedPeers.has(id)) return;
            _original.send(id, { _sys: true, type: "REQ", ts: Date.now() });
        };
        peer.call = function(id, options) {
            if (!id) return;
            if (_internal.confirmedPeers.has(id)) {
                const mode = adaptiveThrottle();
                const constraints = options || {
                    video: mode === 'high' ? true : { frameRate: mode === 'medium' ? 15 : 10 },
                    audio: true
                };
                return _original.call(id, constraints);
            } else {
                safeHandshake(id);
                _original.emit('call:sent', { to: id });
                return null;
            }
        };
        peer.send = function(id, data) {
            const payload = typeof data === 'string' ? { _sys: false, body: data, ts: Date.now() } : data;
            return _original.send(id, payload);
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
                        _original.emit('call:accepted', { from, ts: data.ts });
                        setTimeout(() => peer.call(from), 100);
                        break;
                    case "REJ":
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
            const s = _internal.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            _internal.activeStreams.delete(id);
            _original.emit('secure:closed', { id });
        });
        peer.acceptCall = (id) => {
            _internal.confirmedPeers.add(id);
            _original.send(id, { _sys: true, type: "ACC", ts: Date.now() });
            setTimeout(() => peer.call(id), 100);
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
