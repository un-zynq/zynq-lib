/**
 * ZYNQ Auto-Security Injector
 * Patcht de globale ZYNQ.Peer class zodat elke nieuwe instantie 
 * standaard beveiligd is met het handshake-protocol.
 */
(function() {
    const OriginalPeer = ZYNQ.Peer;

    // We overschrijven de constructor
    ZYNQ.Peer = function(config) {
        const peer = new OriginalPeer(config);
        
        // --- Interne Beveiligings State ---
        const safety = {
            confirmedPeers: new Set(),
            pendingRequest: null
        };

        const originalCall = peer.call.bind(peer);
        const originalSend = peer.send.bind(peer);

        // --- Overwrite: .call() ---
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

        // --- Overwrite: .send() ---
        peer.send = function(id, data) {
            // Als data een simpele string is, verpakken we hem
            if (typeof data === 'string') {
                return originalSend(id, { _sys: false, body: data, ts: Date.now() });
            }
            return originalSend(id, data);
        };

        // --- Systeem Handler ---
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
                        safety.pendingRequest = null;
                        break;
                }
                return; // Voorkom dat systeemdata de normale message flow raakt
            }

            // Emit opgeschoond bericht event voor de app
            if (data && data.body) {
                window.dispatchEvent(new CustomEvent('secure:message', { detail: { from, text: data.body } }));
            }
        });

        // --- Firewall op de stream ---
        peer.on('stream', ({ from, stream }) => {
            if (!safety.confirmedPeers.has(from)) {
                stream.getTracks().forEach(t => t.stop()); // Hardwarematige kill
                window.dispatchEvent(new CustomEvent('secure:violation', { detail: { from } }));
            }
        });

        // --- Extra Methods toevoegen ---
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

    // Zorg dat de prototype-keten intact blijft (voor library compatibiliteit)
    ZYNQ.Peer.prototype = OriginalPeer.prototype;
})();
