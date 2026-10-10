const priorities = { debug: 10, info: 20, warn: 30, error: 40, silent: Infinity };
// Whitelist fields instead of serializing requests, errors, bodies, or environment objects.
const allowedFields = new Set([
  'requestId', 'method', 'statusCode', 'durationMs', 'code', 'port', 'host', 'signal',
]);

export function createLogger({ level = 'info', sink = process.stdout } = {}) {
  const write = (severity, event, fields = {}) => {
    if (priorities[severity] < priorities[level]) return;
    const safeFields = Object.fromEntries(Object.entries(fields).filter(([key]) => allowedFields.has(key)));
    sink.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: severity, event, ...safeFields })}\n`);
  };
  return Object.freeze(Object.fromEntries(['debug', 'info', 'warn', 'error'].map((severity) =>
    [severity, (event, fields) => write(severity, event, fields)],
  )));
}
