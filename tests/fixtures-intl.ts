// International and v11 offer-card fixtures (typical layouts; tune against real captures).

/** Eurozone Uber card in English, decimal commas, km, accented rider name. */
export const EU_UBER = `UberX
€12,50
Zoë ★ 4,91
4 min (1,2 km) away
Hauptstraße 5, Berlin
18 min (9,8 km) trip
Alexanderplatz, Berlin
Accept`;

/** Egypt Uber card with Arabic-Indic digits, Arabic units and an Arabic rider name. */
export const EG_UBER_ARABIC = `UberX
EGP ١٢٥٫٥٠
أحمد ★ ٤٫٨٧
٥ دقائق (٢٫٣ كم) بعيد
شارع التحرير، الدقي
٢٢ دقيقة (١١٫٤ كم) رحلة
مدينة نصر، القاهرة
Accept`;

/** UK card: pounds, miles, separate boost. */
export const UK_UBER = `UberX
£8.40
+£1.50 Boost
4.95★
6 min (1.9 mi) away
Camden Rd, London
17 min (6.2 mi) trip
Brixton Hill, London
Accept`;

/** Lyft card that also prints a "Total" line. */
export const LYFT_WITH_TOTAL = `Lyft
$16.80
4.9 ★
6 min · 2.1 mi away
Pickup near Merrifield
21 min · 10.4 mi trip
Dropoff near Reston
Total 27 min · 12.5 mi
Match`;

/** Same card where the pickup line was not readable: the total fills it in. */
export const LYFT_TOTAL_NO_PICKUP = `Lyft
$16.80
4.9 ★
Pickup near Merrifield
21 min · 10.4 mi trip
Dropoff near Reston
Total 27 min · 12.5 mi
Match`;

/** Card that only shows a total (no separate legs). */
export const TOTAL_ONLY = `UberX
$19.00
★ 4.90
Total 30 min (14.0 mi)
Reston Town Center, Reston
Accept`;

/** Suffix euro symbol and European thousands: "1.234,50 €" style. */
export const EU_SUFFIX = `Comfort
32,40 €
★ 4,88
7 min (3,4 km) away
Rue de Rivoli, Paris
41 min (28,6 km) trip
Aéroport CDG, Roissy
Accept`;
