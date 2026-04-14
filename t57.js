/**
 * ZYNQ Ultra-Secure & Performance Patch (t55.js)
 * Versie: 1.1 - Per-session Handshake & New Naming
 */
(function() {
    const OriginalPeer = ZYNQ.Peer;

    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);
        
        // --- State Management ---
        const safety = {
            confirmedPeers: new Set(),
            activeStreams: new Map() 
        };

        const originalCall = peer.call.bind(peer);
        const originalSend = peer.send.bind(peer);

        // --- Performance & Catch-up Engine ---
        const optimizeStream = (vEle) => {
            const interval = setInterval(() => {
                if (!vEle) return clearInterval(interval);
                if (vEle.paused) return;
                
                const buffered = vEle.buffered;
                if (buffered.length > 0) {
                    const delay = buffered.end(buffered.length - 1) - vEle.currentTime;
                    
                    // Catch-up: bij > 0.5s lag, skip naar live
                    if (delay > 0.5) { 
                        vEle.currentTime = buffered.end(buffered.length - 1) - 0.1;
                    }

                    // Subtiele versnelling bij lichte buildup
                    vEle.playbackRate = (delay > 0.3) ? 1.05 : 1.0;
                }
            }, 2000);
        };

        // --- Security Overwrites ---
        peer.call = function(id, options) {
            if (!id) return;
            
            // Als de peer al bevestigd is voor deze sessie, bel direct
            if (safety.confirmedPeers.has(id)) {
                return originalCall(id, options || { video: true, audio: true });
            } else {
                // Anders: stuur eerst een Handshake Request
                originalSend(id, { _sys: true, type: "REQ", ts: Date.now() });
                window.dispatchEvent(new CustomEvent('handshake:sent', { detail: { to: id } }));
                return null;
            }
        };

        peer.send = function(id, data) {
            // Wrap string berichten in een beveiligde body
            if (typeof data === 'string') {
                return originalSend(id, { _sys: false, body: data, ts: Date.now() });
            }
            return originalSend(id, data);
        };

        // --- Handlers ---
        peer.on('message', ({ from, data }) => {
            if (data && data._sys) {
                switch(data.type) {
                    case "REQ":
                        window.dispatchEvent(new CustomEvent('handshake:request', { detail: { from, ts: data.ts } }));
                        break;
                    case "ACC":
                        safety.confirmedPeers.add(from);
                        window.dispatchEvent(new CustomEvent('handshake:accepted', { detail: { from, ts: data.ts } }));
                        // Start de daadwerkelijke media stream na acceptatie
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
            // Blokkeer streams van onbekenden (geen actieve handshake)
            if (!safety.confirmedPeers.has(from)) {
                stream.getTracks().forEach(t => t.stop());
                window.dispatchEvent(new CustomEvent('secure:violation', { detail: { from } }));
                return;
            }
            
            safety.activeStreams.set(from, stream);
            window.dispatchEvent(new CustomEvent('secure:stream', { detail: { from, stream, optimize: optimizeStream } }));
        });

        // Garbage Collection & Session Reset
        peer.on('close', ({ id }) => {
            // CRUCIAAL: Verwijder uit confirmedPeers zodat bij de volgende keer opnieuw handshake nodig is
            safety.confirmedPeers.delete(id);
            
            const s = safety.activeStreams.get(id);
            if (s) s.getTracks().forEach(t => t.stop());
            safety.activeStreams.delete(id);
            
            window.dispatchEvent(new CustomEvent('secure:closed', { detail: { id } }));
        });

        // --- Public Interface Methods ---
        
        peer.acceptCall = (id) => {
            safety.confirmedPeers.add(id);
            originalSend(id, { _sys: true, type: "ACC", ts: Date.now() });
            originalCall(id, { video: true, audio: true });
        };

        peer.rejectCall = (id) => {
            originalSend(id, { _sys: true, type: "REJ", ts: Date.now() });
            // Zorg dat we deze peer zeker niet in de confirmed lijst hebben staan
            safety.confirmedPeers.delete(id); 
        };

        return peer;
    };

    ZYNQ.Peer.prototype = OriginalPeer.prototype;
})();
