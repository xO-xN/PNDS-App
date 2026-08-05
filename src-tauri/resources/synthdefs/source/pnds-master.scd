// PNDS App master synth — build-time SynthDef source.
//
// Compiles `pndsMaster` into a .scsyndef artifact via `npm run synthdefs:build`
// (see scripts/build-synthdefs.sh). Requires a local SuperCollider install
// (sclang) at build time only — the PNDS App never bundles or invokes sclang.
//
// Contract per docs/PNDS_RUNTIME_CONTRACT.md §7.4:
//   mono: In.ar(in, 1) -> short-lag gain smoothing -> Out.ar(out, 1)
//   - the App creates K instances inside a dedicated master group at the
//     tail of the root group; instance i reads private bus B+i, writes
//     hardware bus i
//   - gain is set on the whole group with one /n_set (default 0.5 == 80%
//     == -6 dB for N <= 2 projects; 1.0 for N > 2)
//
// IMPORTANT: the SynthDef's internal name must stay `pndsMaster`; the App
// references it by name when creating the master synth nodes.

(
var outDir = (thisProcess.argv[0] ? ".").standardizePath;

SynthDef(\pndsMaster, { |in = 2, out = 0, gain = 0.5|
	var sig = In.ar(in, 1);
	var level = Lag.kr(gain, 0.05);
	Out.ar(out, sig * level);
}).writeDefFile(outDir);

("[pnds] wrote " ++ outDir ++ "/pndsMaster.scsyndef").postln;
0.exit;
)
