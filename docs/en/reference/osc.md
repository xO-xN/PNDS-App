# Open Sound Control (OSC) Protocol

Open Sound Control (OSC) is a real-time message protocol for synthesizers, multimedia software and interactive devices. It usually carries typed address messages such as `/filter/cutoff` over UDP. OSC carries control and events, not the audio stream itself.

## OSC routing in PNDS

| Audio mode | Receiver                                  | Message and target ownership                                                                        |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Internal   | App-managed scsynth                       | The project uses standard scsynth OSC for SynthDefs, nodes and buffers; the Host injects its target |
| External   | Configured external synthesizer or device | The work defines musical message semantics; the Host injects the applied external OSC target        |
| None       | No audio target                           | Score pages and network interaction may run without producing sound                                 |

The work defines mappings from touches and parameters to sound; these artistic semantics differ from Host-owned target configuration. See [injected environment variables](./runtime-contract.md#3-environment-variables-the-app-injects) for `PNDS_OSC_TARGET`, and [Audio modes](./audio-modes.md) for comparison. An external-target change applies at the next start or explicit restart.

After changing SCD, compile from its creation-mode file toolbar, then restart to adopt `.scsyndef` output. Source, artifact and compilation requirements belong to [the SynthDef compilation contract](./supercollider.md#the-synthdef-compilation-contract).
