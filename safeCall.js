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

        // 🧠 STATE MACHINE (this fixes duplicates properly)
        const state = {
            peers: new Map(), // id -> state
            streams: new Map(),
            retries: new Map()
        };

        const orig = {
            call: peer.call.bind(peer),
            send: peer.send.bind(peer),
            emit: peer.emit.bind(peer)
        };

        // 🔒 ID-EMPOTENT EMITTER (NO DUPLICATES EVER FOR SAME STATE)
        const emitState = (event, payload) => {
            const id = payload?.id || payload?.from;

            if (event === "secure:closed") {
                if (state.peers.get(id) === "closed") return;
                state.peers.set(id, "closed");
            }

            if (event === "secure:stream") {
                const key = id + ":stream";
                if (state.peers.get(key)) return;
                state.peers.set(key, true);
            }

            orig.emit(event, payload);
        };

        // 🧠 adaptive stream tuning
        const adaptive = () => {
            const count = state.streams.size;
            if (count > 6) return 'low';
            if (count > 3) return 'medium';
            return 'high';
        };

        const optimize = (el) => {
            if (!el) return;

            let last = Date.now();

            const loop = setInterval(() => {
                if (!el || !el.srcObject) return clearInterval(loop);
                if (el.paused || el.readyState < 3) return;

                const mode = adaptive();
                const now = Date.now();

                if (mode === 'low' && now - last < 1500) return;
                if (mode === 'medium' && now - last < 1000) return;

                last = now;

                const b = el.buffered;
                if (b.length > 0) {
                    const end = b.end(b.length - 1);
                    const delay = end - el.currentTime;

                    if (delay > 0.8) {
                        el.currentTime = end - 0.02;
                    } else if (delay > 0.2) {
                        el.playbackRate = mode === 'high' ? 1.06 : 1.03;
                    } else {
                        el.playbackRate = 1.0;
                    }
                }
            }, 800);
        };

        const handshake = (id) => {
            if (state.peers.get(id) === "confirmed") return;

            orig.send(id, { _sys: true, type: "REQ", ts: Date.now() });

            const r = state.retries.get(id) || 0;
            if (r < 3) {
                setTimeout(() => {
                    if (state.peers.get(id) !== "confirmed") {
                        state.retries.set(id, r + 1);
                        handshake(id);
                    }
                }, 1500);
            }
        };

        // 📞 CALL
        peer.call = function(id, opts) {
            if (!id) return;

            if (state.peers.get(id) === "confirmed") {
                return orig.call(id, opts || { audio: true, video: false });
            }

            handshake(id);
            emitState("call:sent", { to: id });
            return null;
        };

        peer.send = function(id, data) {
            const payload = typeof data === "string"
                ? { _sys: false, body: data, ts: Date.now() }
                : data;

            return orig.send(id, payload);
        };

        // 📩 MESSAGE FLOW
        peer.on("message", ({ from, data }) => {
            if (!data) return;

            if (data._sys) {
                switch (data.type) {

                    case "REQ":
                        emitState("call", {
                            from,
                            ts: data.ts,
                            accept: () => peer.acceptCall(from),
                            reject: () => peer.rejectCall(from)
                        });
                        break;

                    case "ACC":
                        state.peers.set(from, "confirmed");
                        state.retries.delete(from);

                        emitState("call:accepted", { from, ts: data.ts });

                        setTimeout(() => peer.call(from), 100);
                        break;

                    case "REJ":
                        state.retries.delete(from);
                        emitState("call:rejected", { from, ts: data.ts });
                        break;
                }
            } else if (data.body) {
                emitState("secure:message", {
                    from,
                    text: data.body,
                    ts: data.ts
                });
            }
        });

        // 🎥 STREAM
        peer.on("stream", ({ from, stream }) => {
            if (state.peers.get(from) !== "confirmed") {
                stream.getTracks().forEach(t => t.stop());
                emitState("secure:violation", { from });
                return;
            }

            state.streams.set(from, stream);

            emitState("secure:stream", {
                from,
                stream,
                optimize
            });
        });

        // ❌ CLOSE (NOW 100% IDEMPOTENT)
        peer.on("close", ({ id }) => {
            if (state.peers.get(id) === "closed") return;

            state.peers.set(id, "closed");

            state.retries.delete(id);

            const s = state.streams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            state.streams.delete(id);

            emitState("secure:closed", { id });
        });

        // 🤝 ACCEPT / REJECT
        peer.acceptCall = (id) => {
            state.peers.set(id, "confirmed");

            orig.send(id, {
                _sys: true,
                type: "ACC",
                ts: Date.now()
            });

            setTimeout(() => peer.call(id), 100);
        };

        peer.rejectCall = (id) => {
            orig.send(id, {
                _sys: true,
                type: "REJ",
                ts: Date.now()
            });

            state.peers.delete(id);
        };

        return peer;
    };

    ZYNQ.Peer.prototype = OriginalPeer.prototype;
    return ZYNQ.Peer;
}));
