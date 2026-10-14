# Field protocol: does matching a tailwind keep you dry?

The model predicts that in a steady tailwind the water hitting your chest and back falls to zero
when you move at exactly the wind speed, and rises linearly either side of it. This protocol tests
that prediction with three absorbent pads and a kitchen scale. No lab is needed, only a rainy,
steadily windy day.

## The idea in one line

A pad on top of your head measures the rain falling on you, and a pad on your chest or back
measures the rain driven at you. Their ratio is `|your speed − tailwind| / drop fall speed`. Rain
intensity, pad size and trial duration all cancel, so the dip can be measured even when the rain
comes and goes.

## Equipment

| Item | Notes |
|---|---|
| 3 × absorbent pads per trial, 20 × 20 cm | Disposable lab bench pads or incontinence pads with a waterproof back. Cut to size; they must not drip when wet. |
| Rigid backing boards, 20 × 20 cm | Thin plastic or foam board, so the pads stay flat and keep their orientation. |
| Harness | Chest plate facing forward, back plate facing backward, cap with a horizontal top plate. Keep the plates vertical (chest/back) and horizontal (cap) while moving. |
| Zip bags, numbered | One per pad. Weigh pads sealed in their bags. |
| Scale, 0.01 g resolution | A cheap jewellery scale is fine. Weigh before and after inside a car or doorway. |
| Anemometer | Handheld, at 1.5 m height, on the course. Record the mean wind along the course for each trial. |
| Rain gauge (optional) | A cross-check for the top pad. |
| Stopwatch, tape measure, cones | Mark a straight course. |

## Course

- A straight, open path of **100 m**, running **downwind**. The wind should blow along the course,
  not across it; record the angle if it does not.
- Avoid buildings and trees upwind. They create gusts and rain shadows.
- Mark the start and finish with cones, plus a 10 m run-up so you reach speed before the start line.

## Speeds

Use nine target speeds per repeat, **0.8, 1.2, 1.6, 2.0, 2.4, 2.8, 3.3, 4.0 and 5.0 m/s**, and add
two extra trials within ±0.3 m/s of the measured wind speed. Pace yourself with a metronome app or a
cyclist alongside, and record the actual time. The analysis uses the measured speed, not the target.

**Randomise the order** of speeds within each repeat. Rain and wind drift over an afternoon; a
random order stops that drift from looking like a speed effect.

## Procedure for each trial

1. Take three fresh pads out of their sealed bags and weigh each **in its bag**. Record the
   `*_dry_g` masses.
2. Mount the pads: one on the cap (facing up), one on the chest plate, one on the back plate. Keep
   them covered (for example under an umbrella) until the start line.
3. Uncover them at the start line, cross the 100 m at the target pace, and cover them again at the
   finish. Time the crossing between the two lines.
4. Return each pad to its bag immediately and seal it. Weigh it within 10 minutes and record the
   `*_wet_g` masses.
5. Read the anemometer's mean over the trial, plus the rain gauge if you use one.
6. Note anything unusual: a gust, a passing car's spray, a pad touching your arm.

## What to record

Use `trials_template.csv`, one row per trial:

| Column | Meaning |
|---|---|
| `trial_id`, `date`, `time_start` | Identification |
| `course_m` | Course length (100) |
| `speed_target_mps` | The pace you aimed for |
| `duration_s` | The measured time between the lines |
| `wind_along_mps` | Anemometer mean along the course (positive = tailwind) |
| `wind_across_mps` | Crosswind component, if any |
| `rain_gauge_mm` | Gauge depth during the trial (optional) |
| `pad_area_cm2` | 400 for 20 × 20 cm pads |
| `top_dry_g` … `back_wet_g` | The six weighings |
| `notes` | Free text |

## Analysis

```
node experiment/analyze.js experiment/my_trials.csv
```

The script:

- computes each trial's speed and the ratios front/top and back/top;
- fits the wind-aware model `ratio = k · max(0, ±(v − Ux))`, giving the tailwind `Ux` (compare it
  with the anemometer) and `k = η / vt`, which combines the drop fall speed with the aerodynamic
  collection efficiency;
- fits a wind-blind alternative in which the chest just sweeps rain at a rate proportional to `v`;
- compares the two by AIC. A ΔAIC above 10 is strong evidence for the dip;
- bootstraps 95% confidence intervals.

The fitted `k` is itself a result. With `vt` from the drop size (measured with a disdrometer, or
estimated from the rain rate), `η = k · vt` is a direct field measurement of how much the airflow
around a body deflects rain, which the model can only estimate (see the paper's airflow section).

## How many trials

`node experiment/simulate-campaign.js` runs this protocol on synthetic data with realistic noise.
With a steady 2 m/s tailwind:

| Conditions | Repeats (trials) | 95% interval on the wind speed | Dip detected |
|---|---|---|---|
| Typical (gusts ±0.35 m/s, handling ±4%) | 1 (9) | ±0.3 m/s | 100% |
| Typical | 2 (18) | ±0.2 m/s | 100% |
| Pessimistic (gusts ±0.8 m/s, rain ±50%, handling ±12%) | 1 (9) | ±0.9 m/s | 43% |
| Pessimistic | 3 (27) | ±0.4 m/s | 95% |

**Plan for three repeats (27 trials plus the extras near the wind speed).** That is one long
afternoon for two people.

`example_synthetic_trials.csv` shows what the data should look like. It is synthetic, generated
from the model, and is not a measurement.

## Safety and ethics

- Run on a closed or quiet path. Never run beside traffic in the rain.
- Wear shoes with grip. Wet surfaces are slippery at 5 m/s.
- Stop if there is lightning.
