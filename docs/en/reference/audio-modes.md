# Audio Modes

The audio mode decides what makes the Project's sound; view and switch it in the App's sidebar:

| Mode           | Behaviour                                                            |
| -------------- | -------------------------------------------------------------------- |
| Internal Synth | Uses the App's bundled `scsynth` and the Project's `.scsyndef` files |
| External Synth | Sends OSC to a synthesiser or device of your choosing                |
| None           | No audio — the score and its network interactions only               |

Runtime behaviour (scsynth startup, the OSC target, the App master stage) is covered in [runtime-contract.md](./runtime-contract.md) §6; changes to the mode, device or External target take effect through a full session restart — no runtime hot-switching.
