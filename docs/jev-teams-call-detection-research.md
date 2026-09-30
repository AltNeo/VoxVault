# Jev for Teams call-transition detection

Research scope: official TypeSafe AI documentation only, reviewed 2026-09-30.

## Bottom line

Jev can classify a compact sequence of local Teams observations into `started`,
`ongoing`, `ended`, `switched`, or `uncertain`. It should not be the sensor, event
store, or state machine. TypeSafe explicitly recommends normal code own workflow,
deterministic rules, and side effects while Jev handles narrow judgments
([How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)).

Main limitation: Jev cannot detect a call switch if input only says "call controls
present" before and after. VoxVault must first capture a meeting/session identity
signal (for example, stable Teams UI metadata or another local identifier). Jev can
then judge ambiguous transitions between structured snapshots.

## Relevant documented behavior

- API is request/response: `POST https://api.typesafe.ai/v1/systemone` with one
  `state` and named typed questions. Answers return under matching names
  ([API reference](https://docs.typesafe.ai/api)). Official API docs do not describe
  persistent pipeline state, event subscriptions, streaming, or webhooks. Therefore,
  VoxVault must retain previous observations and send them with current observation.
- State may be a string, JSON object, or array of text values. Jev does not accept
  audio, image, or video; non-text signals must be preprocessed into structured text
  ([State](https://docs.typesafe.ai/concepts/state),
  [Models](https://docs.typesafe.ai/models)).
- `Choice` matches this bounded classification problem. It returns selected option,
  probability per option, and confidence
  ([Choice](https://docs.typesafe.ai/primitives/choice)).
- Multiple narrow questions can be evaluated independently and in parallel in one
  request. Extra questions usually add little response time
  ([Introduction](https://docs.typesafe.ai/introduction),
  [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out)).
- TypeSafe says most queries complete in about 100 ms. One official 13-question,
  54k-character cookbook benchmark averaged 0.27 s per batched call; that is an
  example, not a latency SLA
  ([How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one),
  [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions)).
- Current Jev 1.13 limits shown by docs: 40 requests/s, 100k tokens/s, 64k request
  context, text-only input, and $0.042 per million input tokens. Limits may change
  without notice ([Models](https://docs.typesafe.ai/models)).
- JavaScript SDK supports per-call timeout, cancellation, and retry overrides.
  Defaults are 10 s per attempt and two retries; no total retry budget. Retry defaults
  cover connection failures, timeouts, 408, 429, and 5xx with exponential backoff
  ([TypeSafeClientConfig](https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig),
  [RequestOptions](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions),
  [RetryPolicy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy)).
- Confidence is a routing signal, not a correctness guarantee. TypeSafe recommends
  conservative thresholds tested on domain data, with low-confidence results causing
  no action or escalation
  ([Confidence](https://docs.typesafe.ai/confidence)).
- Repeated results are not deterministic. In one official 15-repeat Choice cookbook,
  raw TypeSafe label agreement was 90.8%; a 0.60 top-probability abstention policy
  produced 99.2% decision agreement while abstaining on 25.8% of answers. Authors
  stress this measures repeatability, not accuracy
  ([Self-consistency: choices](https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook)).
- Jev 1.13 is weak at date/time comparison, numeric precision, indirection, and large
  irrelevant state. Docs advise computing time/arithmetic in code, keeping questions
  literal and atomic, and filtering state first
  ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)).
- Customer requests are not used for training. Zero-data-retention is documented as
  an enterprise option, not the default
  ([Models](https://docs.typesafe.ai/models),
  [Legal](https://docs.typesafe.ai/legal)).

## Minimal suitable design

```text
Teams-local probes -> normalized observation -> short local history
                  -> Jev Choice -> confidence gate -> code state machine
                  -> start / keep / split / stop recording
```

Send compact structured state, not transcript or raw accessibility tree:

```json
{
  "previous_stable": {
    "recording": true,
    "call_fingerprint": "hash:a1",
    "leave_control": true,
    "toolbar_control": true
  },
  "current": {
    "call_fingerprint": "hash:b7",
    "leave_control": true,
    "toolbar_control": true
  },
  "transition": {
    "fingerprint_changed": true,
    "gap_bucket": "under_2_seconds",
    "probe_health": "good"
  }
}
```

Use one `Choice`:

```json
{
  "call_transition": {
    "type": "choice",
    "instructions": "Classify the Teams call transition between previous_stable and current.",
    "criteria": {
      "started": "No prior active call; current observation is an active call.",
      "ongoing": "Same identifiable active call continues.",
      "ended": "Prior call was active; current observation reliably shows no active call.",
      "switched": "Prior and current calls are active but their reliable fingerprints differ.",
      "uncertain": "Signals are unhealthy, contradictory, or insufficient."
    }
  }
}
```

Code should enforce invariants and side effects:

- Never stop or split on API error, timeout, low confidence, or `uncertain`; hold last
  stable state and probe again.
- Compute fingerprint comparison and elapsed-time buckets locally. Do not ask Jev to
  compare timestamps.
- Require high confidence for `ended` and `switched`, because wrong actions corrupt
  recording boundaries. Tune threshold using labeled Teams traces; docs provide no
  call-detection threshold.
- Pin a version such as `jev-1.13.0` during validation. `jev-latest` can move and alter
  answers; response reports actual model version
  ([Models](https://docs.typesafe.ai/models)).
- Use short per-call timeout and at most one retry for this real-time path. Default SDK
  retry budget can delay a transition for tens of seconds.

## Does this solve immediate call switching?

Only with a new call fingerprint. If call A ends and call B begins before polling, both
snapshots may show the same `Leave` and `More` controls. No classifier can recover a
switch absent distinguishing evidence. Priority investigation should be a stable local
identifier from Teams accessibility metadata, window/subtree metadata, deep-link data,
or another local source. If none exists, increase probe frequency and retain a rapid
control-disappearance/reappearance sequence, but this remains probabilistic.

Jev may help fuse imperfect evidence (brief toolbar gap, changed title fragments,
process/UI subtree changes). It does not replace missing evidence.

## Validation gate before integration

Capture labeled traces for idle, preview, ringing, joining, active, minimized, muted,
leaving, post-leave, failed probe, and immediate A-to-B switch. Replay each trace
against a pinned model multiple times. Measure start/end/switch precision and recall,
abstention rate, transition latency, repeated-decision agreement, timeout/error rate,
and recording-boundary errors. Compare against a deterministic baseline using the same
signals. Ship Jev only if it materially improves ambiguous cases without increasing
false stops or missed switches.

## Documentation gaps

Official docs found no call-detection case study, persistent Jev pipeline runtime,
webhook/event API, latency SLA, availability SLA, offline mode, idempotency contract,
or published accuracy for Teams-style temporal transition classification. Suitability
must therefore be established with VoxVault-specific labeled traces.
