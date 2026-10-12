(
var outDir = thisProcess.argv[0];
var source = thisProcess.argv[1];
var result = 1;
try {
    source.load;
    SynthDescLib.global.at(\pndsBlank).def.writeDefFile(outDir);
    result = 0;
} { |error| error.reportError };
result.exit;
)
