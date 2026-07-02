import { exec } from 'child_process';
import { promisify } from 'util';
import config from '../config.js';

const execAsync = promisify(exec);

/**
 * Send a PDF file to the printer via CUPS `lp` command.
 * @param {string} filePath - Path to the PDF
 * @param {object} options
 * @param {number} options.copies
 * @param {boolean} options.isDuplex
 * @param {string} options.colorMode - 'bw' or 'color'
 * @returns {Promise<{success: boolean, cupsJobId: string|null}>}
 */
export async function printFile(filePath, options = {}) {
  const {
    copies = 1,
    isDuplex = false,
    colorMode = 'bw',
  } = options;

  const printerName = config.printer.name;
  const sides = isDuplex ? 'two-sided-long-edge' : 'one-sided';
  const color = colorMode === 'color' ? 'RGB' : 'Gray';

  const cmd = [
    'lp',
    `-d "${printerName}"`,
    `-n ${copies}`,
    `-o sides=${sides}`,
    `-o ColorModel=${color}`,
    `-o fit-to-page`,
    `"${filePath}"`,
  ].join(' ');

  console.log(`[PRINTER] Executing: ${cmd}`);

  if (!config.printer.enabled) {
    console.log('[PRINTER] Printer disabled in config — simulating print');
    // Simulate printing delay for demo/testing
    await new Promise((r) => setTimeout(r, 3000));
    return { success: true, cupsJobId: `SIM-${Date.now()}` };
  }

  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stderr) console.warn('[PRINTER] stderr:', stderr);

    // CUPS outputs: "request id is PrinterName-123 (1 file(s))"
    const match = stdout.match(/request id is (\S+)/);
    const cupsJobId = match ? match[1] : null;

    console.log(`[PRINTER] Job submitted: ${cupsJobId}`);
    return { success: true, cupsJobId };
  } catch (error) {
    console.error('[PRINTER] Print failed:', error.message);
    throw new Error(`Print failed: ${error.message}`);
  }
}

/**
 * Check if the printer is online and ready.
 * @returns {Promise<{online: boolean, status: string}>}
 */
export async function getPrinterStatus() {
  if (!config.printer.enabled) {
    return { online: true, status: 'Simulated (printer disabled in config)', name: config.printer.name };
  }

  try {
    const { stdout } = await execAsync(`lpstat -p "${config.printer.name}"`);
    const online = stdout.includes('idle') || stdout.includes('printing');
    return {
      online,
      status: stdout.trim(),
      name: config.printer.name,
    };
  } catch (error) {
    return { online: false, status: error.message, name: config.printer.name };
  }
}
