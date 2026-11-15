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
