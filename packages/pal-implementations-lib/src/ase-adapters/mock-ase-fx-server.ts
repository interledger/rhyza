import * as http from 'http';
import { URL } from 'url';

const PORT = 7000;
const RATES_PATH = '/rates';

const RATES: { base: string; rates: { [key: string]: number } }[] = [
  { base: 'EUR', rates: { USD: 1.12, GBP: 0.84, XRP: 0.02 } },
  { base: 'USD', rates: { EUR: 0.813399, GBP: 0.728125, XRP: 0.0225 } },
  { base: 'GBP', rates: { EUR: 1.2451, USD: 1.453125, XRP: 0.0275 } },
  { base: 'XRP', rates: { EUR: 0.0002, USD: 0.000225, GBP: 0.000275 } }
];

const server = http.createServer(
  (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Only serve GET requests to the root path '/rates'
    const parsedUrl = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (req.method !== 'GET' || parsedUrl.pathname !== RATES_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    // Mandatory "base" query parameter
    const baseParam = parsedUrl.searchParams.get('base');

    if (!baseParam) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: 'Missing mandatory query parameter: "base"' })
      );
      return;
    }

    // Get the rate
    const rate = RATES.find((r) => r.base === baseParam);
    if (!rate) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Rate not found' }));
      return;
    }

    // 3. Success response
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        base: baseParam,
        rates: rate.rates,
        mockedAt: new Date().toISOString()
      })
    );
  }
);

// Start the server
server.listen(PORT, () => {
  console.log(`Mock server is running on http://localhost:${PORT}`);
});
