# Phase 2H-VC source reconciliation

Branch: `codex/d5o-phase2hvc-integrated`; application commit: `d4fb1da3db046a981942f1f85bf0bad7a96eef54`. The branch starts at Operate evidence commit `025b1036f6bdae91d72e409fe897e551ca9a6e23` (application `776bc00e2ea93a21c7f9e496fc6c67fd9adcaad8`). Git ancestry confirms that RC0 application `3710ecace04e54769b5761da83f12594562e95b3`, RC0 evidence `ebad4b2b59ca65654777811a40ccde046f929e07`, RC2-B staging guard `c3ce6d26f305d7c204e5366c84f1fcb9aa6d4e44`, and RC2-D evidence `cf781d39e831a6d396f0116326aac59173fd43f4` are all ancestors. No historical branch merge or shared Work/My Work replacement was required.

The inherited integrated tree retains administration, invitations and membership, published configuration, tenant lifecycle/entitlements, tenant-neutral Work, Define, Design, Develop, connected-service authorization/job creation, Deploy, Operate, My Work, phase projection, evidence controls, pilot restrictions and the staging environment identity guard. This package changes only the Operate acceptance SQL boundary and qualification runners. It introduces no competing engine or product capability.

The [checksum manifest](evidence/D5O_PHASE2HVC_MIGRATION_CHECKSUMS.json) verifies all 234 RC0 executable migrations byte-for-byte and adds one forward migration, SHA-256 `d0ec41ca79f9adbc5a95d3ce814fbf1ce7a8c615ec1ec3d021e686f8edf35bd1`. Its execution version is `20261027085730`, after the RC0 chain. The pre-existing excluded duplicate `0016...-ShawnT13.sql` remains excluded as in RC0. No historical file changed.

The primary checkout's unrelated changes were left in place. The isolated worktree is under `C:\Users\futte\Projects\Rybex 2\.tmp-d5o-phase2hvc-integrated`.
