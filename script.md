# Windcast video script (read aloud)

Total: about 9 minutes. Words in plain text are spoken; **[brackets]** are what to show on screen.
Read at a normal pace (about 130 words a minute). Each part is about 4½ minutes, under the 5-minute limit.

Setup: start your screen recorder (QuickTime ▸ File ▸ New Screen Recording, with your mic on),
then in a terminal run:

```bash
cd vqmzk/e2e && node demo.mjs https://vqmzk.vercel.app
```

Brave walks through the dashboard on its own. Pause and resume your speech to follow it,
or just click around yourself. Webcam is optional.

---

## Part 1: client pitch (about 4½ min)

**[Dashboard, top of page]**

Hi, I'm [your name]. Over the pilot we looked at one question for your trading desk:
when you commit to day-ahead volumes, how much can you trust the official wind forecast?

Every morning your desk has to lock in volumes for tomorrow, and wind is the biggest
single uncertainty in that decision. Windcast shows you exactly what the national wind
forecast said at the moment you had to decide, and how far that forecast can be trusted.

**[Main chart: hover over a point]**

This is the important idea. The blue line is not the latest forecast. It's the forecast
you would actually have seen when you made the decision: by ten o'clock the day before
delivery. The black line is what the wind actually generated. The shaded band shows where
reality landed eight times out of ten. If I hover here, you can see which forecast run was
used and how far ahead it was made: on average, about twenty-six hours.

**[KPI cards]**

Now the headline numbers for January. On average the forecast was off by two gigawatts.
That's about eighteen percent of typical wind output. And the error isn't random: the
forecast ran about one point seven gigawatts too high. That's wind you planned for that
never showed up, which you then had to buy back at short notice. One hour in ten, the
shortfall was more than four point two gigawatts. That's a defensible number for sizing
your cover.

**[Change cutoff to 08:00, then switch to fixed lead time and move the slider]**

You can set the cutoff to match your real decision time. You can also ask a different
question: if we could wait longer before deciding, how much better would it get?

**[Lead-time chart, then by-hour and daily charts]**

Here's the answer. The error grows from about one point seven gigawatts an hour ahead, to
one point nine a day ahead, to two point three two days ahead. So deciding closer to
delivery is worth around fifteen to twenty percent in accuracy. Errors are worst around
five in the morning. And bad days come in clusters: the eleventh and twelfth of January,
and the twenty-eighth, were each off by about five gigawatts.

**[Click 28 January: forecast evolution chart]**

This is the twenty-eighth. Every forecast run for that day stayed well above what was
delivered. When a whole sequence of runs drifts like this, that's an early warning
your desk can act on.

**[Back to top]**

For a full rollout, the next steps are live data, a bias-corrected forecast, and alerts
when forecast runs disagree. I'd be happy to scope that with you. Thank you.

---

## Part 2: tech lead review (about 4½ min)

**[GitHub repo, README architecture section]**

Now the technical walkthrough. The code is on GitHub and the app is deployed on Vercel.
The frontend is React with Vite, TypeScript and Recharts. The backend is FastAPI in Python,
with the analysis written as pure functions using numpy.

January 2026 is history, so the data never changes. A script, `scripts/fetch_data.py`,
pulls actuals and forecasts from the Elexon API once and saves a compressed snapshot of
about a hundred and ten kilobytes in the repo. That means the app has no runtime dependency
on Elexon, and starts and responds instantly.

**[backend/app/analysis.py]**

This is the key design decision. Every forecast run is kept with its publish time. For each
target hour, the forecasts are sorted by publish time, so finding the latest run before the
cutoff is a binary search with `bisect`. That guarantees no look-ahead: we never use a
forecast that was published after the decision.

There are two selection rules. Day-ahead uses a cutoff time on the day before delivery, in
UK local time, using `zoneinfo`, so it's correct across clock changes. There's a unit test
for that. Fixed lead time uses the target time minus a number of hours. Rows where a run
forecasts the past are dropped, and the maximum lead time is seventy-two hours. Forecasts are
hourly and actuals half-hourly, so errors are matched on start time. The evaluation window
is the second of January to the first of February: the deliveries for decisions made in
January.

**[backend/app/main.py]**

The API is small: metadata, the time series, the metrics, the lead-time curve, which is
cached, and the forecast evolution for a single day. Inputs are validated, with a maximum
window, and a bad range returns a 422.

**[frontend/src]**

On the frontend, `api.ts` is a typed client, `App.tsx` holds state and layout, and
`charts.tsx` has one component per chart. All times are shown in UK time, and it supports
dark mode.

**[Test files, Dockerfile, vercel.json]**

For quality: pytest unit tests cover forecast selection and the statistics. Playwright
end-to-end tests run in a real browser, Brave, against the running app. A multi-stage
Dockerfile builds the frontend and serves the API and UI on one port. On Vercel, the API runs
as a Python function and the static build is served from the CDN.

**[README]**

The README covers the files, how to run it, and the live link. I built this with help from
Claude Code, and the README says so.

Limitations and next steps. The confidence band is in-sample, so in production I'd compute it
over a trailing window. The idea that wind curtailment causes the bias is a hypothesis, not
verified. And the natural next steps are live data ingestion and a bias-correction model.
Thanks for reviewing.
