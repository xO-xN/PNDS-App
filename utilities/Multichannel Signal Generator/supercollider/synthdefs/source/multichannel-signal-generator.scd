// PNDS Multichannel Signal Generator — master SynthDef (build-time source).
//
// Compiles `toneTest` into a .scsyndef artifact via sclang (see
// scripts/build-multichannel-signal-generator.sh). The App never bundles or invokes sclang.
//
// The def is MONO by design: the project creates 16 instances, one per
// private output bus. Instance i plays a steady sine and writes ONLY its
// own bus (in/out are per-instance controls):
//
//   SinOsc(freq, 0) -> ~20ms gain smoothing -> Out.ar(out, 1)
//
// Controls (per instance):
//   freq  — tone frequency in Hz (monitor faders pick per-channel pitches)
//   gain  — linear amplitude; 0 silences the tone (Mute)
//   out   — the private output bus this instance writes (PNDS_AUDIO_OUTPUT_BUS + i)
//
// IMPORTANT: the SynthDef's internal name must stay `toneTest`; the
// project references it by name when creating the 16 instances.

(
var outDir = (thisProcess.argv[0] ? ".").standardizePath;

SynthDef(\toneTest, { |freq = 440, gain = 0, out = 0|
	var sig = SinOsc.ar(freq, 0) * Lag.kr(gain, 0.02);
	Out.ar(out, sig);
}).writeDefFile(outDir);

("[pnds] wrote " ++ outDir ++ "/multichannel-signal-generator.scsyndef").postln;
0.exit;
)
