// Technical placeholder: one silent channel, routed to the injected private bus.
// Source for pndsBlank.scsyndef; compile through PNDS App after changing it.
SynthDef(\pndsBlank, { |out = 2|
    Out.ar(out, DC.ar(0));
}).add;
