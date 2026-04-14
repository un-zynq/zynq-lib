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
        const debug = !!(config && typeof config === 'object' && config.debug);
        const log = (...args) => { if (debug) console.log('[ZYNQ Secure Peer]', ...args); };
        const _internal = {
            peerStates: new Map(),
            activeStreams: new Map()
        };
        const _original = {
            call: peer.call.bind(peer),
            send: peer.send.bind(peer),
            emit: peer.emit.bind(peer)
        };
        const getOrCreatePeerState = (id) => {
            if (!_internal.peerStates.has(id)) {
                _internal.peerStates.set(id, {
                    status: 'idle',
                    retryCount: 0,
                    retryTimer: null,
                    lastReqTime: 0,
                    activeStreamId: null
                });
            }
            return _internal.peerStates.get(id);
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
        const initiateHandshake = (id) => {
            const state = getOrCreatePeerState(id);
            if (['confirmed', 'streaming'].includes(state.status)) return;
            const now = Date.now();
            if (now - state.lastReqTime < 1500) return;
            state.status = 'calling';
            state.lastReqTime = now;
            _original.send(id, { _sys: true, type: "REQ", ts: Date.now() });
            if (state.retryTimer) {
                clearTimeout(state.retryTimer);
                state.retryTimer = null;
            }
            const backoff = Math.min(1200 * Math.pow(1.8, state.retryCount), 8000);
            state.retryTimer = setTimeout(() => {
                state.retryTimer = null;
                if (state.status === 'calling' && state.retryCount < 5) {
                    state.retryCount++;
                    initiateHandshake(id);
                }
            }, backoff);
        };
        peer.call = function(id, options) {
            if (!id) return;
            const state = getOrCreatePeerState(id);
            if (['confirmed', 'streaming'].includes(state.status)) {
                const mode = adaptiveThrottle();
                const constraints = options || {
                    video: mode === 'high' ? true : { frameRate: mode === 'medium' ? 15 : 10 },
                    audio: true
                };
                log('Performing actual call to confirmed peer:', id);
                return _original.call(id, constraints);
            } else {
                log('Initiating handshake for peer:', id);
                initiateHandshake(id);
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
                const state = getOrCreatePeerState(from);
                switch (data.type) {
                    case "REQ":
                        if (state.status !== 'ringing') {
                            state.status = 'ringing';
                            _original.emit('call', {
                                from, ts: data.ts,
                                accept: () => peer.acceptCall(from),
                                reject: () => peer.rejectCall(from)
                            });
                        }
                        break;
                    case "ACC":
                        if (state.status === 'calling') {
                            if (state.retryTimer) {
                                clearTimeout(state.retryTimer);
                                state.retryTimer = null;
                            }
                            state.retryCount = 0;
                            state.status = 'confirmed';
                            _original.emit('call:accepted', { from, ts: data.ts });
                            setTimeout(() => peer.call(from), 100);
                        }
                        break;
                    case "REJ":
                        if (state.retryTimer) {
                            clearTimeout(state.retryTimer);
                            state.retryTimer = null;
                        }
                        if (['calling', 'ringing'].includes(state.status)) {
                            state.status = 'idle';
                            state.retryCount = 0;
                            _original.emit('call:rejected', { from, ts: data.ts });
                        }
                        break;
                }
            } else if (data.body) {
                _original.emit('secure:message', { from, text: data.body, ts: data.ts });
            }
        });
        peer.on('stream', ({ from, stream }) => {
            const state = _internal.peerStates.get(from);
            if (!state || !['confirmed', 'streaming'].includes(state.status)) {
                stream.getTracks().forEach(t => t.stop());
                _original.emit('secure:violation', { from });
                return;
            }
            const streamId = stream ? stream.id : null;
            if (!streamId || state.activeStreamId === streamId) {
                log('Duplicate stream ignored for peer:', from);
                return;
            }
            const oldStream = _internal.activeStreams.get(from);
            if (oldStream && oldStream !== stream) {
                oldStream.getTracks().forEach(t => t.stop());
            }
            _internal.activeStreams.set(from, stream);
            state.activeStreamId = streamId;
            state.status = 'streaming';
            log('New secure stream for peer:', from, 'streamId:', streamId);
            _original.emit('secure:stream', { from, stream, optimize: optimizeStream });
        });
        peer.on('close', ({ id }) => {
            const state = _internal.peerStates.get(id);
            if (state) {
                if (state.retryTimer) clearTimeout(state.retryTimer);
                _internal.peerStates.delete(id);
            }
            const s = _internal.activeStreams.get(id);
            if (s) {
                s.getTracks().forEach(t => t.stop());
                _internal.activeStreams.delete(id);
            }
            _original.emit('secure:closed', { id });
        });
        peer.acceptCall = (id) => {
            const state = getOrCreatePeerState(id);
            if (state.status === 'ringing') {
                state.status = 'confirmed';
                _original.send(id, { _sys: true, type: "ACC", ts: Date.now() });
                setTimeout(() => peer.call(id), 100);
            }
        };
        peer.rejectCall = (id) => {
            const state = getOrCreatePeerState(id);
            if (['ringing', 'calling'].includes(state.status)) {
                state.status = 'idle';
                if (state.retryTimer) {
                    clearTimeout(state.retryTimer);
                    state.retryTimer = null;
                }
                state.retryCount = 0;
                _original.send(id, { _sys: true, type: "REJ", ts: Date.now() });
            }
        };
        return peer;
    };
    ZYNQ.Peer.prototype = OriginalPeer.prototype;
    return ZYNQ.Peer;
}));
