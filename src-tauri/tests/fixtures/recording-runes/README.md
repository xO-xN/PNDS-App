# Actual Runes recording integration fixture

Copied from the current saved `runes-pnds` score project on 2026-11-03; the shared recording adapter was updated with that project on 2026-11-04. These are the actual adapted server, composition/transport, player protocol and instrument implementation. No alternate musical state simulator is used. Page assets and SynthDef binaries are omitted: this fixture runs only `--audio-mode none`; original-project tests cover Internal/External/None plus compiled sound controls.

The fixture does not represent audible or macOS media acceptance. The user performs native sound checks separately.

Launch `node server.js --audio-mode none` after selecting isolated manifest performer/monitor ports. Inject `PNDS_SHARED_LIBRARIES` JSON with `socket.io.path` pointing at the App checkout `node_modules/socket.io`. Node 24 is required.

Protocol: loopback GET/POST `/__pnds/recording`, capability `pnds.recording.json`. Performer Socket.IO `runes:join` => `runes:joined`; `runes:control` payload `{active:true, number:3, x:35, y:15, distance:40, angle:45, accel:0, reach:150}`. All joined clients receive `runes:state` with independent touches. Conductor Socket.IO connects to monitor port with auth `{runesScoreRole:"conductor"}`; `runes:score:command` payload `{playing:true}` / `{playing:false,playhead:1000}` has acknowledgment (null when playback locks authority); `runes:score:sync` `{}` has full composition and transport acknowledgment. Read-only HTTP `/__score/state` returns actual composition including items/playhead/playing.

## Exact source SHA-256

- `server.js`: `cec6c7931b14d64bd493e4680d847af3e00d91adb889a1c0844589f15f76414a`
- `score.js`: `418b58cbc44eddf2b26b96fdef59b0e2ba587d2536bf99443d3407b1c3ad17cf`
- `recording.cjs`: `8c9fcb64049bcd6227316b5e42e395975d0bdb2d6e83d2f4e2a74a9ad0ff3841`
- `host-performers.js`: `acfb635f97d70b4f29bc93ad3117669708b1e50f7fda8829f635bfe741a723a0`
- `audio/controller.js`: `83cf59433227d06ed7bafe2a54a5843595c781dc2a442a904559e5e6d20b305c`
- `modules/pnds-players/protocol.js`: `4ac9436df92b42ca2f17dbdd0823ecea4011e19cabd82ac2ce9dc84fc9c0d3f1`
- `pnds.recording.json`: `422b16c2e390290b2bfc72865352c8c33877fb7d1325c775d8e1642fd066cbb5`
- `manifest.json`: `b60e6745504730766ec411ffe90f17cfadd90b782bf4520eb2440eb1b08b64c6`
- `package.json`: `0cef73de23b66118e4460a4bde5634b7d3ff3e0ea480ed3f0ba494d070897b01`
- `modules/pnds-players/package.json`: `1ae37eaf58b0a679dec937ab58ec816c769d497468ed2c132f8517db27fc1909`
