import { createApp } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { log } from "./log.mjs";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { server, startUp } = createApp(config);
server.on("error", (error) => {
  log("service.listen_failed", { code: error.code });
  process.exit(1);
});
server.listen(config.port, config.host, () => {
  log("service.started", { host: config.host, port: config.port });
  if (!config.loopback)
    log("service.warning", {
      message:
        "Listening beyond loopback. Allow only your SEO Pilot runtime through the firewall.",
    });
  void startUp();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
