export function listenForRequests(app, { port = 0, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);

    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      const address = server.address();
      const listeningPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        host,
        port: listeningPort,
        url: `http://${host}:${listeningPort}`,
      });
    });
  });
}
