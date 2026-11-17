// One analyzer per monitored project audio bus, before App master gain.
// Build with npm run synthdefs:build. The App only loads the compiled file.
(
var outDir = (thisProcess.argv[0] ? ".").standardizePath;

SynthDef(\pndsSpectrum, { |in = 2, replyId = 0|
	var fftSize = 8192;
	var chunkSize = 512;
	var chunkCount = fftSize.div(2 * chunkSize);
	var blockSize = BlockSize.ir;
	var hopSize = (2 * blockSize).clip(fftSize / 4, fftSize);
	var hopBlocks = hopSize / blockSize;
	var captureEvery = (SampleRate.ir / (hopSize * 24)).ceil.max(
		((2 * chunkCount) / hopBlocks).ceil
	);
	var snapshot = LocalBuf(fftSize);
	// A Hann-windowed, bin-centered sine has magnitude N/4 times its amplitude.
	var signal = In.ar(in) * (4 / fftSize);
	var chain = FFT(LocalBuf(fftSize), signal, hopSize / fftSize, 1);
	var fftReady = chain >= 0;
	var filled = PulseCount.kr(fftReady) >= (fftSize / hopSize);
	var capture = PulseDivider.kr(fftReady * filled, captureEvery);
	var selected = Select.kr(capture, [-1, chain]);
	// A zero threshold converts the selected complex frame to polar without smoothing.
	var copied = PV_Copy(PV_MagAbove(selected, 0), snapshot);
	var frameReady = (copied >= 0) * capture;
	var frame = PulseCount.kr(frameReady);
	var elapsedBlocks = Sweep.kr(frameReady, ControlRate.ir).round(1);
	var chunk = (elapsedBlocks / 2).floor;
	var send = (frame > 0) * (chunk < chunkCount) * ((elapsedBlocks % 2) < 1);
	// Reuse the same demand-rate readers across all chunks. The snapshot stays
	// fixed until all of its chunks have been sent.
	var bins = Demand.kr(send, frameReady, Array.fill(chunkSize, { |index|
		Dbufrd(snapshot, Dseries(2 * index, 2 * chunkSize, chunkCount), 0)
	}));
	// Buffer element 0 is signed DC. Element 1 is Nyquist and is omitted.
	var firstBin = Select.kr(chunk < 1, [bins[0], bins[0].abs * 0.5]);
	SendReply.kr(send, '/pnds/spectrum', [frame, chunk, firstBin] ++ bins.drop(1), replyId);
}).writeDefFile(outDir);

0.exit;
)
