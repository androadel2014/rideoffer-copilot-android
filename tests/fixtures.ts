import type { CardInput } from '../src/engine/types';
import { textToLines } from '../src/ocr/parser';

export const card = (text: string, pass: 'crop' | 'frame' = 'crop'): CardInput => ({
  text,
  lines: textToLines(text),
  pass,
});

export const UBER_STANDARD = `UberX
$18.42
Sarah ★ 4.93
5 mins (1.8 mi) away
Fair Lakes Pkwy & Monument Dr, Fairfax
22 mins (13.6 mi) trip
Wilson Blvd & N Lynn St, Arlington
Accept`;

export const UBER_DEAD_ZONE = `UberX
$31.10
★ 4.97
7 mins (2.9 mi) away
Fair Oaks Mall, Fairfax
48 mins (41.2 mi) trip
Main St, Warrenton, VA
Accept`;

export const LYFT_BONUS = `Lyft
$14.20
+$3.00 Bonus
4.88 ★
8 min · 3.1 mi
Pickup near Tysons Galleria, McLean
19 min · 9.4 mi
Dropoff near Bethesda Row, Bethesda
Match`;

export const UBER_OCR_NOISE = `Comfort
S24.75
Picking up Michael
4.91 *
6 rnins (2.2 mi) away
Mosaic District, Merrifield
1 hr 5 min (38.4 mi) trip
Includes 2 stops
Dulles Town Center, Sterling
Accept`;

// --- vc12 regression: the TOTAL line is the whole job, never the pickup leg ----------------

/**
 * Field-test card (vc12 defect 2). The card shows the whole job as "22 min / 7.8 mi",
 * and the legs as 5 min (1.1 mi) away + 17 min (6.7 mi) trip. vc11 read the total line as
 * the pickup and added the trip again (39 min / 14.5 mi). It must grade on 22 min / 7.8 mi:
 * net $5.79 → $15.79/hr and $0.74/mi → BAD (floors $18/hr, $0.80/mi; cost $0.30/mi).
 */
export const VC12_TOTAL_LINE_CARD = `UberX
$8.13
★ 4.94
22 min / 7.8 mi
5 min (1.1 mi) away
Fair Lakes Pkwy, Fairfax
17 min (6.7 mi) trip
Wilson Blvd, Arlington
Accept`;

/** Same card when OCR reads only the total and the trip leg (no pickup line). */
export const VC12_TOTAL_LINE_NO_PICKUP = `UberX
$8.13
★ 4.94
22 min / 7.8 mi
Fair Lakes Pkwy, Fairfax
17 min (6.7 mi) trip
Wilson Blvd, Arlington
Accept`;

/** Same card when OCR puts the word "Total" on its own line above the numbers. */
export const VC12_TOTAL_LABEL_SPLIT = `UberX
$8.13
★ 4.94
Total
22 min / 7.8 mi
5 min (1.1 mi) away
Fair Lakes Pkwy, Fairfax
17 min (6.7 mi) trip
Wilson Blvd, Arlington
Accept`;

/** Lyft-style layout: three unlabelled time/distance lines (total, pickup, trip). */
export const VC12_LYFT_UNLABELLED_TOTAL = `Lyft
$8.13
4.94 ★
22 min · 7.8 mi
5 min · 1.1 mi
Pickup near Fairfax
17 min · 6.7 mi
Dropoff near Arlington
Match`;

// --- vc13 regression: real UberX Exclusive card from the owner's field test -------------------

/**
 * Real screenshot (Nov 16 2026). The card's TOTAL line "51 min • 31.9 mi" has no label, and
 * neither leg says "away" or "trip". It must grade on the total, not on either leg:
 * cost 31.9 mi × $0.30 = $9.57 → net $9.49 → $11.16/hr, $0.30/mi → BAD.
 */
export const VC13_UBERX_EXCLUSIVE_REAL = `UberX
Exclusive
$19.06
51 min • 31.9 mi
★ 4.90
Verified
10 min (3.1 mi)
Gallows Rd, Falls Church
1 stop
41 mins (28.8 mi)
Aircraft Dr, Germantown
Accept`;
