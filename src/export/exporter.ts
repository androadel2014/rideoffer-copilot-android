import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { listOffers, listWaits } from '../db/database';
import { settingsStore } from '../state/settingsStore';
import { offersToCsv, toJsonExport, waitsToCsv } from './format';

export type ExportKind = 'offers_csv' | 'waits_csv' | 'all_json';

export interface ExportResult {
  ok: boolean;
  message: string;
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/**
 * Writes the export to the app's private cache and opens the Android share sheet.
 * Sharing is a local Intent (no network); the driver picks where the file goes.
 */
export async function exportHistory(kind: ExportKind, range: { sinceTs?: number; sessionId?: number } = {}): Promise<ExportResult> {
  try {
    const offers = await listOffers({ ...range, limit: 100_000 });
    const waits = await listWaits({ ...range, limit: 100_000 });
    if (offers.length === 0 && waits.length === 0) return { ok: false, message: 'Nothing to export yet.' };

    let name: string;
    let content: string;
    let mimeType: string;
    if (kind === 'offers_csv') {
      if (offers.length === 0) return { ok: false, message: 'No offers to export in this range.' };
      name = `rideoffer-offers-${stamp()}.csv`;
      content = offersToCsv([...offers].reverse());
      mimeType = 'text/csv';
    } else if (kind === 'waits_csv') {
      if (waits.length === 0) return { ok: false, message: 'No wait records to export in this range.' };
      name = `rideoffer-waits-${stamp()}.csv`;
      content = waitsToCsv([...waits].reverse());
      mimeType = 'text/csv';
    } else {
      name = `rideoffer-history-${stamp()}.json`;
      content = toJsonExport([...offers].reverse(), [...waits].reverse(), {
        driverId: settingsStore.get().settings.driverId,
        exportedAt: Date.now(),
      });
      mimeType = 'application/json';
    }

    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(content);

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: true, message: `Saved ${name} in the app's files, but sharing isn't available on this device.` };
    }
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: 'Export RideOffer history' });
    return { ok: true, message: `Exported ${name}` };
  } catch (e: any) {
    return { ok: false, message: `Export failed: ${e?.message ?? 'unknown error'}` };
  }
}
