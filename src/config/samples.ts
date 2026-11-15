/** Sample offer-card OCR text used by "Try the grader" so the full pipeline can be tested without a live offer. */
export const SAMPLE_CARDS: Array<{ id: string; label: string; text: string }> = [
  {
    id: 'uber',
    label: 'Sample Uber offer (to Arlington)',
    text: `UberX
$18.42
★ 4.93
5 mins (1.8 mi) away
Fair Lakes Pkwy & Monument Dr, Fairfax
22 mins (13.6 mi) trip
Wilson Blvd & N Lynn St, Arlington
Accept`,
  },
  {
    id: 'lyft',
    label: 'Sample Lyft offer (with bonus)',
    text: `Lyft
$14.20
+$3.00 Bonus
4.88 ★
8 min · 3.1 mi
Pickup near Tysons Galleria, McLean
19 min · 9.4 mi
Dropoff near Bethesda Row, Bethesda
Match`,
  },
  {
    id: 'dead',
    label: 'Sample dead-zone offer (to Warrenton)',
    text: `UberX
$31.10
★ 4.97
7 mins (2.9 mi) away
Fair Oaks Mall, Fairfax
48 mins (41.2 mi) trip
Main St, Warrenton, VA
Accept`,
  },
];
