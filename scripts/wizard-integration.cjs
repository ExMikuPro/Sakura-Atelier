// CDP is enabled only for this disposable development host, on a free local port.
const net = require('node:net');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  process.env.SAKURA_TEST_CDP_PORT = String(server.address().port);
  process.env.SAKURA_TEST_SUITE = 'wizard';
  process.env.SAKURA_VSCODE_VERSION ||= 'stable';
  server.close(() => require('./integration.cjs'));
});
server.on('error', error => { console.error(error); process.exitCode = 1; });
