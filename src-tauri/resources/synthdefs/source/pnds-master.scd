// PNDS App master synth — build-time SynthDef source.
//
// Compiles `pndsMaster` into a .scsyndef artifact via `npm run synthdefs:build`
// (see scripts/build-synthdefs.sh). Requires a local SuperCollider install
// (sclang) at build time only — the PNDS App never bundles or invokes sclang.
//
// Contract per docs/PNDS_APP_REQUIREMENTS.md §6.4:
//   In.ar(in, 2) -> short-lag gain smoothing -> Out.ar(out, 2)
//   - created after the project group so project audio passes through it
//   - gain default 0.5 == 80% == -6 dB
//
// IMPORTANT: the SynthDef's internal name must stay `pndsMaster`; the App
// references it by name when creating the master synth node.

(
var outDir = (thisProcess.argv[0] ? ".").standardizePath;

SynthDef(\pndsMaster, { |in = 2, out = 0, gain = 0.5|
	var sig = In.ar(in, 2);
	var level = Lag.kr(gain, 0.05);
	Out.ar(out, sig * level);
}).writeDefFile(outDir);

("[pnds] wrote " ++ outDir ++ "/pndsMaster.scsyndef").postln;
0.exit;
)
