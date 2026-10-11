# D5O fictional pilot: Rybex-user walkthrough tasks

Status: **prepared, not observed**. No Rybex participant has been contacted, invited or provisioned. The tasks below are business outcomes for participants, not instructions to click a particular control. All records and documents are fictional.

## Isolated session checkpoints

| Checkpoint | Normal landing URL | Displayed application build |
| --- | --- | --- |
| Delivery review, `d5o-observe-delivery-20261010` | [Local delivery Work](http://127.0.0.1:61644/work?workspace=rybex) | `7a4fcb58bad5` |
| Support follow-through, `d5o-observe-support-20261010` | [Local support Work](http://127.0.0.1:61645/work?workspace=rybex) | `7a4fcb58bad5` |

Use only the role account assigned by the facilitator. Begin at the normal Work landing page. These localhost URLs work on the host computer; remote participation requires an access method that Shawn explicitly arranges. Do not publish a tunnel, deploy a preview or invite participants as part of this preparation.

Facilitator reset between participants, from the repository checkout:

```powershell
pwsh -NoProfile -File scripts/reset-d5o-observation-checkpoint.ps1 -Checkpoint delivery
pwsh -NoProfile -File scripts/reset-d5o-observation-checkpoint.ps1 -Checkpoint support
```

Run only the reset for the checkpoint used in that session. It is scoped to the two named disposable targets and restores private files and attributes as well as database facts. See the [facilitator notes](d5o-rybex-observation-facilitator-20261010.md) for source checksums, exact pending decisions, account handling and reset safeguards. Do not give those expected answers to a participant.

## Participant tasks

| Role | Checkpoint | Business outcome |
| --- | --- | --- |
| Project manager | Support | Find the next assigned documentation obligation. Explain which accepted work it belongs to, what information is missing and who must act next. |
| Project manager | Support | Review the handoff. Explain the differences between customer acceptance, delivery receipt, accepted support ownership, support activation and Finance position. |
| Supervisor or Quality reviewer | Delivery | Find a submitted field fact that needs independent review. Identify its package, governing release and retained evidence; record the decision the evidence supports. |
| Supervisor or Quality reviewer | Delivery | Explain whether the North package can progress with the reported failed inspection, and what verified correction would change that position. |
| Operations/support user | Support | Find the exact delivery-to-support source. Identify who received delivery, who accepted ongoing support responsibility and whether support is active. |
| Operations/support user | Support | Inspect the pending retained as-built version and decide whether it completes the assigned documentation obligation. Identify who must act after the decision. |
| Operations/support user | Support | Identify what remains outstanding after activation and whether each item affects support, Finance or neither. |

Success is a participant finding and understanding the right governed action, not an empty queue. Stop when a prerequisite is unclear. Record assistance and the participant's own interpretation in the [blank observation record](d5o-rybex-user-walkthrough-observations-20261010.md); do not supply an answer and attribute it to the participant.
