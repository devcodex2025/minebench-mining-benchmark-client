# PawnIO module provenance

These files are redistributed inside the MineBench bundle as the privileged broker's
kernel-module payload. They are third-party artifacts, not build output:

| File | SHA-256 |
| --- | --- |
| `AMDFamily0F.bin` | `a6e11619e87a97820705a6523714f22d676ce44f902631833d4429b89d509d55` |
| `AMDFamily10.bin` | `6443080b2968474ffbc38aa4356cc56f9664349fa4b917afdb33027d6bb50525` |
| `AMDFamily17.bin` | `dae74615761b78bdf064dfb3e136252ddcc6fc727d88f14738d0e5800d427a91` |
| `COPYING` | `1e7e6bae5a5bde32f1ae5a7c37a082d1ab03cf89354f7f936ac40be9e39a6531` |
| `IntelMSR.bin` | `d6ed85d65ab17a22f813ef98207d6d537155ee2ded5976a21cb48413c9b92e5f` |
| `LpcIO.bin` | `b3896a1cab0d808fca31fe2ebcae045d59dac690da87b17c858bb8da357eb45e` |

`COPYING` next to these files carries the upstream licence (GNU LGPL 2.1).
The digests are what `scripts/generate-sbom.mjs` records as component hashes, so the
SBOM and this file agree.
